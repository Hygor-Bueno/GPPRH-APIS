/**
 * @fileoverview Regra central do miepp: qual playlist um player deve tocar AGORA.
 *
 * É a decisão que o `GET /miepp/device/playlist` devolve a cada player, e a
 * única regra do módulo que precisa estar 100% coberta por teste — um erro aqui
 * não aparece como exceção, aparece como a tela errada tocando na loja.
 *
 * Fica no domínio, então é **pura e síncrona**: quem busca os agendamentos e os
 * grupos do player no banco é o caso de uso. Ela recebe a lista já materializada
 * e apenas filtra e ordena.
 *
 * A ordem dos filtros é a do documento de requisito (alvo → data → horário →
 * dia da semana → prioridade) e foi mantida literal, mesmo onde uma ordem
 * diferente seria marginalmente mais barata: é essa sequência que o requerente
 * consegue conferir lendo o código.
 *
 * ─── Limitação conhecida: janela que cruza a meia-noite ──────────────────────
 * O critério de horário é `start_time <= agora <= end_time`, como especificado.
 * Isso significa que um agendamento 22:00→02:00 **nunca casa**: às 23:00 falha
 * o `end_time >= agora`, e à 01:00 falha o `start_time <= agora`. Para cobrir
 * madrugada hoje é preciso cadastrar dois agendamentos (22:00→23:59:59 e
 * 00:00→02:00). Não foi "consertado" aqui de propósito — inverter o teste
 * quando `end_time < start_time` muda o significado de dados já cadastrados e
 * precisa ser decisão do requerente, não efeito colateral.
 *
 * @module modules/global/domain/miepp/schedule/schedule-resolver.rules
 */

const { TargetType } = require('../miepp.enums');
const { coversWeekday } = require('./days-of-week');

/**
 * Normaliza uma coluna DATE para `YYYY-MM-DD`.
 *
 * O pool MySQL não usa `dateStrings`, então DATE chega como `Date` (meia-noite
 * local). Aceitar string também é o que deixa a função testável sem construir
 * `Date` em todo caso de teste.
 *
 * @param {Date|string|null|undefined} value
 * @returns {string|null} `null` quando a coluna é NULL (= "sem limite").
 */
function toDateKey(value) {
    if (value === null || value === undefined || value === '') return null;

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        const year  = String(value.getFullYear()).padStart(4, '0');
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day   = String(value.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    // Já vem como 'YYYY-MM-DD' ou 'YYYY-MM-DD HH:MM:SS' — o prefixo basta.
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/**
 * Normaliza uma coluna TIME para `HH:MM:SS`, zero-padded, para que a
 * comparação lexicográfica equivalha à cronológica.
 *
 * @param {string|Date|null|undefined} value
 * @returns {string|null} `null` quando a coluna é NULL (= "sem limite").
 */
function toTimeKey(value) {
    if (value === null || value === undefined || value === '') return null;

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return [value.getHours(), value.getMinutes(), value.getSeconds()]
            .map((part) => String(part).padStart(2, '0'))
            .join(':');
    }

    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value).trim());
    if (!match) return null;

    const hour   = match[1].padStart(2, '0');
    const minute = match[2];
    const second = match[3] || '00';
    return hour + ':' + minute + ':' + second;
}

/**
 * Timestamp comparável para o desempate por "atualizado mais recentemente".
 *
 * @param {Date|string|null|undefined} value
 * @returns {number} epoch em ms; `0` quando indeterminado (perde o desempate).
 */
function toEpoch(value) {
    if (!value) return 0;
    const time = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
}

/**
 * O agendamento aponta para este player?
 *
 * `target_type = 'all'` vale para qualquer player; `player` casa pelo id do
 * próprio player; `group` casa por qualquer grupo em que ele esteja. Basta um
 * alvo casar — um agendamento sem nenhum alvo cadastrado não atinge ninguém.
 *
 * @param {{targets?: Array<{target_type: string, target_id: number|null}>}} schedule
 * @param {number} playerId
 * @param {Set<number>} groupIds
 * @returns {boolean}
 */
function targetsPlayer(schedule, playerId, groupIds) {
    const targets = schedule.targets || [];

    return targets.some((target) => {
        if (target.target_type === TargetType.ALL) return true;

        if (target.target_type === TargetType.PLAYER) {
            return Number(target.target_id) === Number(playerId);
        }

        if (target.target_type === TargetType.GROUP) {
            return groupIds.has(Number(target.target_id));
        }

        return false;
    });
}

/**
 * Passo 3 do requisito — a data de hoje cabe na vigência?
 * Coluna NULL significa "sem limite desse lado".
 *
 * @param {object} schedule
 * @param {string} todayKey - `YYYY-MM-DD`
 * @returns {boolean}
 */
function withinDateRange(schedule, todayKey) {
    const startDate = toDateKey(schedule.start_date);
    const endDate   = toDateKey(schedule.end_date);

    if (startDate && startDate > todayKey) return false;
    if (endDate && endDate < todayKey) return false;
    return true;
}

/**
 * Passo 4 do requisito — a hora atual cabe na janela?
 * Ver a limitação de janela cruzando a meia-noite no cabeçalho do arquivo.
 *
 * @param {object} schedule
 * @param {string} nowKey - `HH:MM:SS`
 * @returns {boolean}
 */
function withinTimeRange(schedule, nowKey) {
    const startTime = toTimeKey(schedule.start_time);
    const endTime   = toTimeKey(schedule.end_time);

    if (startTime && startTime > nowKey) return false;
    if (endTime && endTime < nowKey) return false;
    return true;
}

/**
 * Filtra os agendamentos que se aplicam ao player neste instante.
 *
 * Exposta separada de `resolveActiveSchedule` porque é o que o painel precisa
 * para responder "por que esta tela está tocando isso?" — mostrar todos os
 * candidatos, não só o vencedor.
 *
 * @param {object}   params
 * @param {object[]} params.schedules - linhas de `miepp_schedules` com `targets` embutidos.
 * @param {number}   params.playerId  - `miepp_players.id`.
 * @param {number[]} [params.groupIds] - grupos do player (`miepp_player_group_members`).
 * @param {Date}     [params.now]     - instante da decisão; default `new Date()`.
 * @returns {object[]} candidatos, sem ordem garantida.
 */
function findMatchingSchedules({ schedules = [], playerId, groupIds = [], now = new Date() }) {
    const todayKey = toDateKey(now);
    const nowKey   = toTimeKey(now);
    const groups   = new Set(groupIds.map(Number));
    const weekday  = now.getDay();

    return schedules.filter((schedule) => {
        // 1. só agendamentos ativos
        if (Number(schedule.active) !== 1) return false;
        // 2. o alvo precisa alcançar este player
        if (!targetsPlayer(schedule, playerId, groups)) return false;
        // 3. vigência por data
        if (!withinDateRange(schedule, todayKey)) return false;
        // 4. janela de horário
        if (!withinTimeRange(schedule, nowKey)) return false;
        // 5. dia da semana no bitmask
        if (!coversWeekday(schedule.days_of_week, weekday)) return false;

        return true;
    });
}

/**
 * Resolve O agendamento vencedor para um player neste instante.
 *
 * Passo 6 do requisito: maior `priority` vence; empate vai para o `updated_at`
 * mais recente. O `id` maior é o terceiro critério — não está no requisito, mas
 * sem ele dois agendamentos salvos no mesmo segundo (o `updated_at` do MySQL
 * tem resolução de 1s) alternariam de forma imprevisível entre requisições, e
 * "a tela pisca entre dois conteúdos" é bem pior de diagnosticar do que uma
 * regra de desempate a mais.
 *
 * @param {object} params - mesmos de `findMatchingSchedules`.
 * @returns {object|null} o agendamento escolhido, ou `null` se nenhum casar
 *                        (passo 7: o chamador decide o fallback).
 */
function resolveActiveSchedule(params) {
    const candidates = findMatchingSchedules(params);
    if (candidates.length === 0) return null;

    return candidates.reduce((winner, candidate) => {
        const byPriority = Number(candidate.priority ?? 0) - Number(winner.priority ?? 0);
        if (byPriority !== 0) return byPriority > 0 ? candidate : winner;

        const byUpdatedAt = toEpoch(candidate.updated_at) - toEpoch(winner.updated_at);
        if (byUpdatedAt !== 0) return byUpdatedAt > 0 ? candidate : winner;

        return Number(candidate.id) > Number(winner.id) ? candidate : winner;
    });
}

module.exports = {
    resolveActiveSchedule,
    findMatchingSchedules,
    targetsPlayer,
    withinDateRange,
    withinTimeRange,
    toDateKey,
    toTimeKey,
};
