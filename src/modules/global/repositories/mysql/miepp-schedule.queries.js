/**
 * @fileoverview Consultas SQL puras para `miepp_schedules` e `miepp_schedule_targets`.
 *
 * @module modules/global/repositories/mysql/miepp-schedule.queries
 */

const COLUMNS = `
    id, name, playlist_id, priority, start_date, end_date, start_time, end_time,
    days_of_week, active, created_by, created_at, updated_at
`;

const SQL_LIST_SCHEDULES = `
    SELECT s.id, s.name, s.playlist_id, s.priority, s.start_date, s.end_date,
           s.start_time, s.end_time, s.days_of_week, s.active, s.created_by,
           s.created_at, s.updated_at,
           pl.name AS playlist_name
    FROM miepp_schedules s
    INNER JOIN miepp_playlists pl ON pl.id = s.playlist_id
    WHERE (? IS NULL OR s.active = ?)
    ORDER BY s.priority DESC, s.updated_at DESC
    LIMIT ? OFFSET ?
`;

const SQL_COUNT_SCHEDULES = `
    SELECT COUNT(*) AS total
    FROM miepp_schedules
    WHERE (? IS NULL OR active = ?)
`;

const SQL_GET_SCHEDULE_BY_ID = `
    SELECT ${COLUMNS} FROM miepp_schedules WHERE id = ?
`;

/**
 * Todos os agendamentos ativos — insumo do `schedule-resolver.rules`.
 *
 * O filtro por player **não** é feito aqui de propósito. O requisito descreve a
 * seleção como uma sequência de filtros auditável, e ela vive no domínio, onde
 * dá para testar sem banco; o SQL só corta o que não depende do player. O
 * volume justifica: são dezenas de linhas, não milhões.
 *
 * `pl.active = 1` no JOIN: agendamento apontando para playlist desativada não
 * deve vencer a disputa de prioridade e depois entregar lista vazia — ele
 * simplesmente não concorre, e o de prioridade menor toca.
 */
const SQL_GET_ACTIVE_SCHEDULES = `
    SELECT s.id, s.name, s.playlist_id, s.priority, s.start_date, s.end_date,
           s.start_time, s.end_time, s.days_of_week, s.active, s.updated_at
    FROM miepp_schedules s
    INNER JOIN miepp_playlists pl ON pl.id = s.playlist_id
    WHERE s.active = 1 AND pl.active = 1
`;

/**
 * Alvos de todos os agendamentos ativos, numa consulta só.
 *
 * Query separada, e não um `GROUP_CONCAT` no SELECT acima: o
 * `group_concat_max_len` do MySQL é 1024 bytes por padrão, o que comporta menos
 * de uma centena de alvos. Ao estourar, o GROUP_CONCAT **trunca em silêncio** —
 * sem erro, sem aviso — e os agendamentos cujos alvos caíram fora do corte
 * simplesmente deixariam de alcançar aquelas telas. Um defeito que se
 * manifestaria como "algumas lojas pararam de trocar o conteúdo", meses depois
 * de o cadastro crescer.
 *
 * O custo é uma consulta a mais por chamada de `/device/playlist`, sobre uma
 * tabela pequena e indexada.
 */
const SQL_GET_ACTIVE_SCHEDULE_TARGETS = `
    SELECT t.schedule_id, t.target_type, t.target_id
    FROM miepp_schedule_targets t
    INNER JOIN miepp_schedules s ON s.id = t.schedule_id
    INNER JOIN miepp_playlists pl ON pl.id = s.playlist_id
    WHERE s.active = 1 AND pl.active = 1
`;

const SQL_INSERT_SCHEDULE = `
    INSERT INTO miepp_schedules
        (name, playlist_id, priority, start_date, end_date, start_time, end_time,
         days_of_week, active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const SQL_UPDATE_SCHEDULE = `
    UPDATE miepp_schedules
    SET name = ?, playlist_id = ?, priority = ?, start_date = ?, end_date = ?,
        start_time = ?, end_time = ?, days_of_week = ?, active = ?
    WHERE id = ?
`;

/** Os alvos caem por CASCADE. */
const SQL_DELETE_SCHEDULE = `
    DELETE FROM miepp_schedules WHERE id = ?
`;

// ─── Alvos ───────────────────────────────────────────────────────────────────

const SQL_GET_SCHEDULE_TARGETS = `
    SELECT id, schedule_id, target_type, target_id, created_at
    FROM miepp_schedule_targets
    WHERE schedule_id = ?
    ORDER BY id
`;

const SQL_INSERT_SCHEDULE_TARGET = `
    INSERT INTO miepp_schedule_targets (schedule_id, target_type, target_id)
    VALUES (?, ?, ?)
`;

const SQL_DELETE_SCHEDULE_TARGET = `
    DELETE FROM miepp_schedule_targets WHERE id = ? AND schedule_id = ?
`;

/**
 * `target_id` é polimórfico e por isso não tem FK (ver comentário no DDL) — a
 * existência do alvo é verificada na aplicação, com estas duas queries, antes
 * de gravar. Sem isso um agendamento apontaria para um grupo inexistente e
 * simplesmente nunca tocaria, sem erro em lugar nenhum.
 */
const SQL_PLAYER_EXISTS = `SELECT id FROM miepp_players WHERE id = ? LIMIT 1`;
const SQL_GROUP_EXISTS  = `SELECT id FROM miepp_player_groups WHERE id = ? LIMIT 1`;

module.exports = {
    SQL_LIST_SCHEDULES,
    SQL_COUNT_SCHEDULES,
    SQL_GET_SCHEDULE_BY_ID,
    SQL_GET_ACTIVE_SCHEDULES,
    SQL_GET_ACTIVE_SCHEDULE_TARGETS,
    SQL_INSERT_SCHEDULE,
    SQL_UPDATE_SCHEDULE,
    SQL_DELETE_SCHEDULE,
    SQL_GET_SCHEDULE_TARGETS,
    SQL_INSERT_SCHEDULE_TARGET,
    SQL_DELETE_SCHEDULE_TARGET,
    SQL_PLAYER_EXISTS,
    SQL_GROUP_EXISTS,
};
