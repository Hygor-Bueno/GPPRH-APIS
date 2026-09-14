/**
 * @fileoverview Consultas SQL puras para `meipp_player_groups` e
 * `meipp_player_group_members`.
 *
 * @module modules/global/repositories/mysql/meipp-player-group.queries
 */

const { PLAYER_STATUS_EXPRESSION } = require('./meipp-player.queries');

const SQL_LIST_GROUPS = `
    SELECT g.id, g.name, g.description, g.created_at, g.updated_at,
           COUNT(m.player_id) AS player_count
    FROM meipp_player_groups g
    LEFT JOIN meipp_player_group_members m ON m.group_id = g.id
    GROUP BY g.id
    ORDER BY g.name
    LIMIT ? OFFSET ?
`;

const SQL_COUNT_GROUPS = `
    SELECT COUNT(*) AS total FROM meipp_player_groups
`;

const SQL_GET_GROUP_BY_ID = `
    SELECT id, name, description, created_at, updated_at
    FROM meipp_player_groups
    WHERE id = ?
`;

/**
 * Membros do grupo.
 *
 * `status` é derivado de `last_seen_at` pela mesma expressão usada nas rotas de
 * player — a coluna `meipp_players.status` só é escrita pelo heartbeat e
 * ficaria eternamente `online` para uma tela caída. Reaproveita
 * `PLAYER_STATUS_EXPRESSION` em vez de repetir o CASE, para as duas telas do
 * painel nunca discordarem sobre quem está no ar.
 *
 * Parâmetros: `[offlineAfterMinutes, group_id]`
 */
const SQL_GET_GROUP_MEMBERS = `
    SELECT p.id, p.uuid, p.name, p.active, p.last_seen_at,
           ${PLAYER_STATUS_EXPRESSION} AS status
    FROM meipp_player_group_members m
    INNER JOIN meipp_players p ON p.id = m.player_id
    WHERE m.group_id = ?
    ORDER BY p.name
`;

const SQL_INSERT_GROUP = `
    INSERT INTO meipp_player_groups (name, description) VALUES (?, ?)
`;

const SQL_UPDATE_GROUP = `
    UPDATE meipp_player_groups SET name = ?, description = ? WHERE id = ?
`;

/** Os vínculos em `meipp_player_group_members` caem por CASCADE. */
const SQL_DELETE_GROUP = `
    DELETE FROM meipp_player_groups WHERE id = ?
`;

/**
 * Vincula um player ao grupo.
 *
 * `INSERT IGNORE` porque a PK composta (player_id, group_id) já garante a
 * unicidade: adicionar duas vezes é intenção idempotente do painel, não erro
 * que mereça 500.
 */
const SQL_ADD_GROUP_MEMBER = `
    INSERT IGNORE INTO meipp_player_group_members (player_id, group_id) VALUES (?, ?)
`;

const SQL_REMOVE_GROUP_MEMBER = `
    DELETE FROM meipp_player_group_members WHERE player_id = ? AND group_id = ?
`;

module.exports = {
    SQL_LIST_GROUPS,
    SQL_COUNT_GROUPS,
    SQL_GET_GROUP_BY_ID,
    SQL_GET_GROUP_MEMBERS,
    SQL_INSERT_GROUP,
    SQL_UPDATE_GROUP,
    SQL_DELETE_GROUP,
    SQL_ADD_GROUP_MEMBER,
    SQL_REMOVE_GROUP_MEMBER,
};
