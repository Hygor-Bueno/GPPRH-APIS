/**
 * @fileoverview Consultas SQL puras da auditoria de ativos GAPP
 * (gapp_active_audit / gapp_active_audit_temp). Sem execução, sem I/O.
 *
 * Escopo: a auditoria pertence ao grupo de trabalho de quem a abriu
 * (gapp_user → gapp_level.group_id_fk) — o mesmo critério de `gapp_active.work_group_fk`.
 *
 * @module modules/global/repositories/mysql/gapp-active-audit.queries
 */

// ─── Abertura ───────────────────────────────────────────────────────

/** Ativos selecionados, restritos ao grupo de trabalho do usuário. `IN (?)` expande o array. */
function sqlListActivesForSnapshot() {
    return `
        SELECT a.active_id, a.brand, a.model, a.number_nf, a.date_purchase, a.value_purchase,
               a.status_active, a.is_vehicle, a.id_active_class_fk, a.units_id_fk,
               a.used_in, a.work_group_fk,
               ac.desc_active_class, u.unit_name
        FROM global.gapp_active a
        LEFT JOIN global.gapp_active_class ac ON ac.id_active_class = a.id_active_class_fk
        LEFT JOIN global.gapp_units u ON u.unit_id = a.units_id_fk
        WHERE a.work_group_fk = ? AND a.active_id IN (?)
        ORDER BY a.active_id
    `;
}

function sqlInsertAudit() {
    return `
        INSERT INTO global.gapp_active_audit
            (user_open_id_fk, initial_data, quantity_active, status_audit)
        VALUES (?, ?, ?, 0)
    `;
}

// ─── Consulta ───────────────────────────────────────────────────────

const AUDIT_FROM = `
    FROM global.gapp_active_audit au
    JOIN global.gapp_user uo ON uo.user_id = au.user_open_id_fk
    JOIN global.gapp_level lo ON lo.level_id = uo.level_id_fk
    LEFT JOIN global.gapp_user uf ON uf.user_id = au.user_finish_id_fk
`;

const AUDIT_SUMMARY_COLUMNS = `
    au.audit_id, au.user_open_id_fk, uo.name AS user_open_name,
    au.user_finish_id_fk, uf.name AS user_finish_name,
    au.quantity_active, au.date_open, au.date_finish, au.status_audit,
    (SELECT COUNT(*) FROM global.gapp_active_audit_temp t WHERE t.audit_id_fk = au.audit_id) AS quantity_registered
`;

// Período sobre `date_open`. `date_end` é inclusivo: pega o dia inteiro.
const AUDIT_FILTER_CLAUSES = {
    audit_id: 'au.audit_id = ?',
    status_audit: 'au.status_audit = ?',
    user_open_id_fk: 'au.user_open_id_fk = ?',
    date_start: 'au.date_open >= ?',
    date_end: 'au.date_open < DATE_ADD(?, INTERVAL 1 DAY)',
    // Auditorias que incluíram o ativo (previsto na abertura, conferido ou não)
    // (JSON_CONTAINS não aceita curinga no path — o JSON_EXTRACT devolve o array de ids)
    active_id: "JSON_CONTAINS(JSON_EXTRACT(au.initial_data, '$.assets[*].active_id'), CAST(? AS JSON))",
};

/** `work_group_fk` é obrigatório e vem sempre do usuário autenticado. */
function buildAuditFilters(filters = {}) {
    const conditions = ['lo.group_id_fk = ?'];
    const params = [filters.work_group_fk];

    for (const [key, clause] of Object.entries(AUDIT_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(key === 'active_id' ? String(Number(filters[key])) : filters[key]);
        }
    }
    return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

function sqlListAudits(filters = {}) {
    const { where, params } = buildAuditFilters(filters);
    const limit = Number(filters.limit) || 20;
    const page = Number(filters.page) || 1;
    const offset = (page - 1) * limit;

    const sql = `
        SELECT ${AUDIT_SUMMARY_COLUMNS}
        ${AUDIT_FROM}
        ${where}
        ORDER BY au.date_open DESC, au.audit_id DESC
        LIMIT ? OFFSET ?
    `;
    return { sql, params: [...params, limit, offset] };
}

function sqlCountAudits(filters = {}) {
    const { where, params } = buildAuditFilters(filters);
    return { sql: `SELECT COUNT(*) AS total ${AUDIT_FROM} ${where}`, params };
}

/** Params: [audit_id, work_group_fk] */
function sqlGetAuditById() {
    return `
        SELECT ${AUDIT_SUMMARY_COLUMNS}, au.initial_data, au.final_data
        ${AUDIT_FROM}
        WHERE au.audit_id = ? AND lo.group_id_fk = ?
    `;
}

/** Params: [audit_id] */
function sqlListAuditItems() {
    return `
        SELECT t.audit_temp_id, t.audit_id_fk, t.active_id_fk, t.user_register_id_fk,
               ur.name AS user_register_name,
               t.identifier_type, t.identifier_value, t.asset_condition,
               t.additional_items, t.observations, t.date_register,
               t.is_transfer, t.transfer_reason, 
               t.transfer_branch_code, 
               t.transfer_costcenter_code, 
               t.transfer_responsible_registration
        FROM global.gapp_active_audit_temp t
        LEFT JOIN global.gapp_user ur ON ur.user_id = t.user_register_id_fk
        WHERE t.audit_id_fk = ?
        ORDER BY t.date_register, t.audit_temp_id
    `;
}

/**
 * Registros de auditorias FINALIZADAS (exceto a atual) com algum dos
 * identificadores informados. `pairs` = [[type, value], ...].
 */
function sqlIdentifierHistory(pairs) {
    const tuples = pairs.map(() => '(?, ?)').join(', ');
    return {
        sql: `
            SELECT t.audit_id_fk, t.active_id_fk, t.identifier_type, t.identifier_value
            FROM global.gapp_active_audit_temp t
            JOIN global.gapp_active_audit au ON au.audit_id = t.audit_id_fk
            WHERE au.status_audit = 2
              AND t.audit_id_fk <> ?
              AND (t.identifier_type, t.identifier_value) IN (${tuples})
        `,
        build: auditId => [auditId, ...pairs.flat()],
    };
}

// ─── Escrita (dentro da transação, com a auditoria travada) ─────────

/** Trava a linha da auditoria até o COMMIT — serializa conferência, finalização e cancelamento. */
function sqlLockAudit() {
    return 'SELECT audit_id, status_audit, initial_data FROM global.gapp_active_audit WHERE audit_id = ? FOR UPDATE';
}

function sqlGetAuditItem() {
    return 'SELECT * FROM global.gapp_active_audit_temp WHERE audit_id_fk = ? AND active_id_fk = ?';
}

/** Outro ativo da mesma auditoria com o mesmo identificador (valores gravados já sem espaços nas pontas). */
function sqlFindItemByIdentifier() {
    return `
        SELECT active_id_fk
        FROM global.gapp_active_audit_temp
        WHERE audit_id_fk = ? AND identifier_type = ? AND identifier_value = ? AND active_id_fk <> ?
        LIMIT 1
    `;
}

/** Transferência registrada na conferência (motivo + destino/responsável vindos do Protheus). */
const TRANSFER_COLUMNS = [
    'is_transfer', 'transfer_reason',
    'transfer_branch_code',
    'transfer_costcenter_code',
    'transfer_responsible_registration',
];
const transferParams = data => TRANSFER_COLUMNS.map(column => (column === 'is_transfer' ? (data.is_transfer ? 1 : 0) : data[column] ?? null));

function sqlInsertAuditItem() {
    return `
        INSERT INTO global.gapp_active_audit_temp
            (audit_id_fk, active_id_fk, user_register_id_fk, identifier_type, identifier_value,
             asset_condition, additional_items, observations, ${TRANSFER_COLUMNS.join(', ')})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${TRANSFER_COLUMNS.map(() => '?').join(', ')})
    `;
}

function buildInsertAuditItemParams(auditId, data) {
    return [
        auditId,
        data.active_id_fk,
        data.user_register_id_fk,
        data.identifier_type,
        data.identifier_value,
        data.asset_condition,
        data.additional_items != null ? JSON.stringify(data.additional_items) : null,
        data.observations,
        ...transferParams(data),
    ];
}

/** Editar a conferência registra quem fez a última alteração e quando. */
function sqlUpdateAuditItem() {
    return `
        UPDATE global.gapp_active_audit_temp
        SET user_register_id_fk = ?, identifier_type = ?, identifier_value = ?,
            asset_condition = ?, additional_items = ?, observations = ?,
            ${TRANSFER_COLUMNS.map(column => `${column} = ?`).join(', ')}, date_register = NOW()
        WHERE audit_id_fk = ? AND active_id_fk = ?
    `;
}

function buildUpdateAuditItemParams(auditId, data) {
    return [
        data.user_register_id_fk,
        data.identifier_type,
        data.identifier_value,
        data.asset_condition,
        data.additional_items != null ? JSON.stringify(data.additional_items) : null,
        data.observations,
        ...transferParams(data),
        auditId,
        data.active_id_fk,
    ];
}

/** Transição condicionada ao status anterior. Params: [to, audit_id, from] */
function sqlUpdateAuditStatus() {
    return 'UPDATE global.gapp_active_audit SET status_audit = ? WHERE audit_id = ? AND status_audit = ?';
}

/** Finalização/cancelamento — só a partir de ABERTA ou EM ANDAMENTO. Params: [final_data, user, status, audit_id] */
function sqlCloseAudit() {
    return `
        UPDATE global.gapp_active_audit
        SET final_data = ?, user_finish_id_fk = ?, date_finish = NOW(), status_audit = ?
        WHERE audit_id = ? AND status_audit IN (0, 1)
    `;
}

module.exports = {
    sqlListActivesForSnapshot,
    sqlInsertAudit,
    sqlListAudits,
    sqlCountAudits,
    sqlGetAuditById,
    sqlListAuditItems,
    sqlIdentifierHistory,
    sqlLockAudit,
    sqlGetAuditItem,
    sqlFindItemByIdentifier,
    sqlInsertAuditItem,
    buildInsertAuditItemParams,
    sqlUpdateAuditItem,
    buildUpdateAuditItemParams,
    sqlUpdateAuditStatus,
    sqlCloseAudit,
};
