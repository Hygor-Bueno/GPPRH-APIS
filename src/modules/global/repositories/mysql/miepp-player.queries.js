/**
 * @fileoverview Consultas SQL puras para `miepp_players`, `miepp_device_tokens`,
 * `miepp_device_commands` e `miepp_player_status_log`.
 *
 * Estão no mesmo arquivo porque são a mesma agregação: token, comando e log de
 * status não existem sem um player e nunca são consultados fora do contexto
 * dele.
 *
 * @module modules/global/repositories/mysql/miepp-player.queries
 */

/**
 * `status` é DERIVADO de `last_seen_at`, não lido da coluna.
 *
 * A coluna só é escrita pelo heartbeat, e sempre com `'online'` — nada mais
 * escreve nela. Uma tela que cai (queda de energia, rede, app travado) pararia
 * de mandar heartbeat e continuaria aparecendo como `online` para sempre, que é
 * o oposto do que um módulo de monitoramento remoto precisa mostrar.
 *
 * Derivar na leitura resolve isso sem processo novo. A alternativa seria um job
 * varrendo `miepp_players` de tempos em tempos — mais peças móveis, e no
 * cluster de 2 instâncias precisaria de trava para não rodar duplicado.
 *
 * A coluna continua existindo e sendo atualizada: ela vira o "último estado
 * conhecido", útil para diagnóstico, e é o que sobra se um dia a derivação for
 * substituída por um job.
 *
 * ⚠️ O que isto NÃO faz: gravar o evento `offline` em `miepp_player_status_log`.
 * O log registra o que a tela reporta, e uma tela caída não reporta nada. Um
 * histórico de quedas exige o job varredor. Ver `docs/miepp.md`.
 *
 * Primeiro parâmetro de toda query que usa isto: minutos de tolerância.
 */
const PLAYER_STATUS_EXPRESSION = `
    CASE
        WHEN p.last_seen_at IS NULL THEN 'unknown'
        WHEN p.last_seen_at >= NOW() - INTERVAL ? MINUTE THEN 'online'
        ELSE 'offline'
    END
`;

const PLAYER_COLUMNS = `
    p.id, p.uuid, p.name, p.location_id, p.hardware_type, p.resolution,
    p.orientation, p.mac_address, p.last_ip, p.app_version,
    ${PLAYER_STATUS_EXPRESSION} AS status,
    p.status AS last_known_status,
    p.last_seen_at, p.active, p.created_at, p.updated_at
`;

/**
 * Lista paginada. `location_id` e `active` são filtros opcionais aplicados pelo
 * truque `(? IS NULL OR coluna = ?)`, que mantém a query única e preparada em
 * vez de concatenar SQL condicional.
 *
 * Parâmetros: `[offlineAfterMinutes, active, active, location_id, location_id, limit, offset]`
 * — o primeiro vem do `PLAYER_STATUS_EXPRESSION` no SELECT.
 */
const SQL_LIST_PLAYERS = `
    SELECT ${PLAYER_COLUMNS}, l.name AS location_name
    FROM miepp_players p
    LEFT JOIN miepp_locations l ON l.id = p.location_id
    WHERE (? IS NULL OR p.active = ?)
      AND (? IS NULL OR p.location_id = ?)
    ORDER BY p.name
    LIMIT ? OFFSET ?
`;

const SQL_COUNT_PLAYERS = `
    SELECT COUNT(*) AS total
    FROM miepp_players p
    WHERE (? IS NULL OR p.active = ?)
      AND (? IS NULL OR p.location_id = ?)
`;

/** Parâmetros: `[offlineAfterMinutes, id]` */
const SQL_GET_PLAYER_BY_ID = `
    SELECT ${PLAYER_COLUMNS}, l.name AS location_name
    FROM miepp_players p
    LEFT JOIN miepp_locations l ON l.id = p.location_id
    WHERE p.id = ?
`;

/** Parâmetros: `[offlineAfterMinutes, uuid]` */
const SQL_GET_PLAYER_BY_UUID = `
    SELECT ${PLAYER_COLUMNS}
    FROM miepp_players p
    WHERE p.uuid = ?
`;

const SQL_INSERT_PLAYER = `
    INSERT INTO miepp_players
        (uuid, name, location_id, hardware_type, resolution, orientation, mac_address, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

const SQL_UPDATE_PLAYER = `
    UPDATE miepp_players
    SET name = ?, location_id = ?, hardware_type = ?, resolution = ?,
        orientation = ?, mac_address = ?, active = ?
    WHERE id = ?
`;

/**
 * Soft-delete: `DELETE /players/:id` desativa. Remoção física levaria junto os
 * tokens, comandos e todo o `miepp_player_status_log` da tela (ON DELETE
 * CASCADE), que é justamente o histórico que se quer preservar ao aposentar um
 * equipamento.
 */
const SQL_DEACTIVATE_PLAYER = `
    UPDATE miepp_players SET active = 0 WHERE id = ?
`;

/** Grupos de um player — entrada do resolvedor de agendamento. */
const SQL_GET_PLAYER_GROUP_IDS = `
    SELECT group_id FROM miepp_player_group_members WHERE player_id = ?
`;

// ─── Tokens de device ────────────────────────────────────────────────────────

/**
 * Autenticação do device: procura o token pelo hash.
 *
 * Os três critérios (hash, não revogado, não expirado) ficam no WHERE de
 * propósito — trazer a linha e decidir no Node abriria espaço para responder
 * diferente conforme o motivo, e a rota precisa devolver 401 genérico em todos
 * os casos.
 *
 * Parâmetros: `[token_hash]`
 */
const SQL_FIND_DEVICE_TOKEN = `
    SELECT t.id, t.player_id, t.expires_at, t.revoked_at,
           p.uuid AS player_uuid, p.name AS player_name, p.active AS player_active
    FROM miepp_device_tokens t
    INNER JOIN miepp_players p ON p.id = t.player_id
    WHERE t.token_hash = ?
      AND t.revoked_at IS NULL
      AND (t.expires_at IS NULL OR t.expires_at > NOW())
    LIMIT 1
`;

/**
 * Carimbo de uso. Roda a cada requisição autenticada do device, então é
 * deliberadamente um UPDATE por id, sem transação e sem leitura prévia.
 */
const SQL_TOUCH_DEVICE_TOKEN = `
    UPDATE miepp_device_tokens SET last_used_at = NOW() WHERE id = ?
`;

const SQL_INSERT_DEVICE_TOKEN = `
    INSERT INTO miepp_device_tokens (player_id, token_hash, expires_at)
    VALUES (?, ?, ?)
`;

/** Revoga todos os tokens vivos do player — usado no pareamento e no revoke. */
const SQL_REVOKE_PLAYER_TOKENS = `
    UPDATE miepp_device_tokens
    SET revoked_at = NOW()
    WHERE player_id = ? AND revoked_at IS NULL
`;

// ─── Comandos remotos ────────────────────────────────────────────────────────

const SQL_INSERT_COMMAND = `
    INSERT INTO miepp_device_commands (player_id, command_type, payload, created_by)
    VALUES (?, ?, ?, ?)
`;

/**
 * Fila pendente do player. O device chama isso em loop, então o índice
 * `idx_miepp_device_commands_player_status` cobre exatamente este WHERE.
 */
const SQL_LIST_PENDING_COMMANDS = `
    SELECT id, command_type, payload, created_at
    FROM miepp_device_commands
    WHERE player_id = ? AND status = 'pending'
    ORDER BY created_at
`;

/** Marca como enviados os comandos que acabaram de ser entregues ao device. */
const SQL_MARK_COMMANDS_SENT = `
    UPDATE miepp_device_commands
    SET status = 'sent'
    WHERE player_id = ? AND status = 'pending'
`;

/**
 * ACK do device. O `player_id` no WHERE impede que um player confirme o comando
 * de outro — o id do comando sozinho é adivinhável.
 *
 * Parâmetros: `[status, command_id, player_id]`
 */
const SQL_ACK_COMMAND = `
    UPDATE miepp_device_commands
    SET status = ?, executed_at = NOW()
    WHERE id = ? AND player_id = ? AND status IN ('pending', 'sent')
`;

const SQL_LIST_PLAYER_COMMANDS = `
    SELECT id, command_type, payload, status, created_by, created_at, executed_at
    FROM miepp_device_commands
    WHERE player_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
`;

// ─── Heartbeat e log de status ───────────────────────────────────────────────

const SQL_UPDATE_PLAYER_HEARTBEAT = `
    UPDATE miepp_players
    SET last_seen_at = NOW(), status = 'online', last_ip = ?, app_version = COALESCE(?, app_version)
    WHERE id = ?
`;

const SQL_INSERT_STATUS_LOG = `
    INSERT INTO miepp_player_status_log (player_id, event_type, detail)
    VALUES (?, ?, ?)
`;

const SQL_LIST_STATUS_LOG = `
    SELECT id, event_type, detail, created_at
    FROM miepp_player_status_log
    WHERE player_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
`;

const SQL_COUNT_STATUS_LOG = `
    SELECT COUNT(*) AS total FROM miepp_player_status_log WHERE player_id = ?
`;

module.exports = {
    PLAYER_STATUS_EXPRESSION,
    SQL_LIST_PLAYERS,
    SQL_COUNT_PLAYERS,
    SQL_GET_PLAYER_BY_ID,
    SQL_GET_PLAYER_BY_UUID,
    SQL_INSERT_PLAYER,
    SQL_UPDATE_PLAYER,
    SQL_DEACTIVATE_PLAYER,
    SQL_GET_PLAYER_GROUP_IDS,
    SQL_FIND_DEVICE_TOKEN,
    SQL_TOUCH_DEVICE_TOKEN,
    SQL_INSERT_DEVICE_TOKEN,
    SQL_REVOKE_PLAYER_TOKENS,
    SQL_INSERT_COMMAND,
    SQL_LIST_PENDING_COMMANDS,
    SQL_MARK_COMMANDS_SENT,
    SQL_ACK_COMMAND,
    SQL_LIST_PLAYER_COMMANDS,
    SQL_UPDATE_PLAYER_HEARTBEAT,
    SQL_INSERT_STATUS_LOG,
    SQL_LIST_STATUS_LOG,
    SQL_COUNT_STATUS_LOG,
};
