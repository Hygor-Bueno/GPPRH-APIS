/**
 * @fileoverview Normalização da janela de datas dos relatórios de exibição.
 *
 * Puro. Separado de `play-event.rules` porque resolve o problema oposto: aquele
 * critica o que o DISPOSITIVO escreve, este critica o que o PAINEL pede para
 * ler — e os dois nunca mudam pelo mesmo motivo.
 *
 * @module modules/global/domain/miepp/play/play-range.rules
 */

/** `YYYY-MM-DD`, o formato que a coluna `play_date` compara direto. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Janela quando o painel não manda nada. */
const DEFAULT_RANGE_DAYS = 30;

/**
 * Teto da janela.
 *
 * Um ano cobre "essa campanha rodou quantas vezes desde que entrou". Acima
 * disso a consulta varre o acumulado inteiro por local e por tela, no servidor
 * de dados que já está apertado — e o número que sai de uma janela de 5 anos
 * não responde pergunta nenhuma que alguém tenha feito.
 */
const MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

/** @private Componentes locais em `YYYY-MM-DD`. */
function toDateKey(date) {
    const pad = (part) => String(part).padStart(2, '0');
    return String(date.getFullYear()).padStart(4, '0')
        + '-' + pad(date.getMonth() + 1)
        + '-' + pad(date.getDate());
}

/** @private `YYYY-MM-DD` válido → `Date` local à meia-noite; senão `null`. */
function parseDateKey(value) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value.trim())) return null;

    const [year, month, day] = value.trim().split('-').map(Number);
    const date = new Date(year, month - 1, day);

    // Recusa data que não existe no calendário (`2026-02-31` viraria 3 de
    // março no construtor do Date, e o relatório sairia de um período que o
    // operador não pediu).
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    return date;
}

/**
 * Resolve `from`/`to` da query string numa janela sempre válida.
 *
 * ─── Por que CORRIGE em vez de recusar ──────────────────────────────────────
 *
 * Isto alimenta tela de relatório com seletor de data. Devolver 400 porque a
 * janela passou de um ano, ou porque o operador inverteu as pontas, deixa a
 * tela vazia e sem explicação. A janela efetivamente usada volta na resposta
 * (`range`), então a correção é visível — e é isso que a torna aceitável.
 *
 * O que NÃO é corrigido em silêncio é data malformada: `from` inválido cai no
 * padrão de 30 dias, e o operador vê pela `range` que o filtro dele não pegou.
 *
 * @param {object} [query] - normalmente `req.query`.
 * @param {Date}   [today] - injetável para teste.
 * @returns {{from: string, to: string, days: number}}
 */
function normalizeRange(query = {}, today = new Date()) {
    const requestedFrom = parseDateKey(query.from);
    const requestedTo = parseDateKey(query.to);

    let to = requestedTo || today;
    let from = requestedFrom || new Date(to.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);

    // Pontas invertidas: o operador trocou os campos. Trocar de volta entrega o
    // período que ele quis ver; manter a inversão entregaria zero linhas.
    if (from.getTime() > to.getTime()) {
        const swap = from;
        from = to;
        to = swap;
    }

    const spanDays = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (spanDays > MAX_RANGE_DAYS) {
        // Encurta pelo INÍCIO: o fim da janela é a data que interessa a quem
        // está olhando "até agora".
        from = new Date(to.getTime() - (MAX_RANGE_DAYS - 1) * DAY_MS);
    }

    const days = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
    return { from: toDateKey(from), to: toDateKey(to), days };
}

module.exports = {
    DATE_PATTERN,
    DEFAULT_RANGE_DAYS,
    MAX_RANGE_DAYS,
    normalizeRange,
};
