/**
 * @fileoverview Consultas SQL puras da auditoria de ativos GAPP
 * (gapp_active_audit / gapp_active_audit_temp). Sem execução, sem I/O.
 *
 * Escopo: a auditoria pertence ao grupo de trabalho de quem a abriu
 * (gapp_user → gapp_level.group_id_fk) — o mesmo critério de `gapp_active.work_group_fk`.
 *
 * A tabela temporária só guarda conferências de auditorias ABERTAS/EM ANDAMENTO:
 * na finalização/cancelamento tudo vai para `final_data` e as linhas são
 * apagadas. Por isso o histórico de identificadores lê o `final_data`.
 *
 * DDL: gapp-active-audit-deploy.sql (fora do repo, junto dos demais DDLs).
 *
 * @module modules/global/repositories/mysql/gapp-active-audit.queries
 */

// ─── Abertura ───────────────────────────────────────────────────────

/**
 * Local do ativo = setor (`gapp_active.used_in`), com o caminho
 * "Empresa > Unidade > Setor". `gapp_active.units_id_fk` é a loja que COMPROU
 * o ativo, não onde ele está — não serve para local.
 */
const depJoin = (alias, column) => `
        LEFT JOIN global.gapp_departaments ${alias} ON ${alias}.dep_id = ${column}
        LEFT JOIN global.gapp_units ${alias}_u ON ${alias}_u.unit_id = ${alias}.unit_id_fk
        LEFT JOIN global.gapp_company ${alias}_c ON ${alias}_c.comp_id = ${alias}_u.comp_id_fk`;
const depPath = alias => `CONCAT_WS(' > ', ${alias}_c.fantasy_name, ${alias}_u.unit_name, ${alias}.dep_name)`;

/**
 * Filtros dos ativos da abertura (a = ativo, ac = classe): só tipo e classe.
 * Unidade e setor dizem ONDE a auditoria acontece (gravados em
 * gapp_active_audit), mas não filtram os ativos.
 */
const ACTIVE_SCOPE_CLAUSES = {
    id_active_class_fk: 'a.id_active_class_fk = ?',
    active_type_id_fk: 'ac.active_type_id_fk = ?',
};

/**
 * Ativos do grupo do usuário, filtrados por classe e tipo (opcionais).
 * Com `activeIds` → só os escolhidos (MANUAL); sem → todos (AUTO), limitado
 * a `limit` linhas.
 *
 * @param {{ unit_id_fk: number, dep_id_fk?: number, id_active_class_fk?: number, active_type_id_fk?: number }} scope
 * @param {number} workGroupFk
 * @param {number[]|null} activeIds
 * @param {number} limit
 */
function sqlListActivesForAudit(scope, workGroupFk, activeIds, limit) {
    const conditions = ['a.work_group_fk = ?'];
    const params = [workGroupFk];

    for (const [field, clause] of Object.entries(ACTIVE_SCOPE_CLAUSES)) {
        if (scope[field] != null) {
            conditions.push(clause);
            params.push(scope[field]);
        }
    }
    if (activeIds?.length) {
        conditions.push('a.active_id IN (?)');
        params.push(activeIds);
    }

    const sql = `
        SELECT a.active_id, a.brand, a.model, a.number_nf, a.date_purchase, a.value_purchase,
               a.status_active, a.is_vehicle, a.id_active_class_fk,
               a.used_in, a.work_group_fk,
               ac.desc_active_class, ac.active_type_id_fk, aty.desc_active_type,
               d.dep_name, ${depPath('d')} AS dep_path
        FROM global.gapp_active a
        LEFT JOIN global.gapp_active_class ac ON ac.id_active_class = a.id_active_class_fk
        LEFT JOIN global.gapp_active_type aty ON aty.active_type_id = ac.active_type_id_fk${depJoin('d', 'a.used_in')}
        WHERE ${conditions.join(' AND ')}
        ORDER BY a.active_id
        LIMIT ?
    `;
    return { sql, params: [...params, limit] };
}

// Referências do escopo / destino da transferência (existência e vínculos)
const sqlFindUnit = () => 'SELECT unit_id, unit_name FROM global.gapp_units WHERE unit_id = ?';
const sqlFindDepartment = () => 'SELECT dep_id, dep_name, unit_id_fk FROM global.gapp_departaments WHERE dep_id = ?';
const sqlFindActiveClass = () => 'SELECT id_active_class, desc_active_class, active_type_id_fk FROM global.gapp_active_class WHERE id_active_class = ?';
const sqlFindActiveType = () => 'SELECT active_type_id, desc_active_type FROM global.gapp_active_type WHERE active_type_id = ?';

function sqlInsertAudit() {
    return `
        INSERT INTO global.gapp_active_audit
            (user_open_id_fk, unit_id_fk, dep_id_fk, id_active_class_fk,
             initial_data, quantity_active, status_audit)
        VALUES (?, ?, ?, ?, ?, ?, 0)
    `;
}

function buildInsertAuditParams(data) {
    return [
        data.user_open_id_fk,
        data.unit_id_fk,
        data.dep_id_fk ?? null,
        data.id_active_class_fk ?? null,
        JSON.stringify(data.initial_data),
        data.quantity_active,
    ];
}

// ─── Consulta ───────────────────────────────────────────────────────

const AUDIT_FROM = `
    FROM global.gapp_active_audit au
    JOIN global.gapp_user uo ON uo.user_id = au.user_open_id_fk
    JOIN global.gapp_level lo ON lo.level_id = uo.level_id_fk
    LEFT JOIN global.gapp_user uf          ON uf.user_id = au.user_finish_id_fk
    LEFT JOIN global.gapp_units un         ON un.unit_id = au.unit_id_fk
    LEFT JOIN global.gapp_departaments dp  ON dp.dep_id = au.dep_id_fk
    LEFT JOIN global.gapp_active_class acl ON acl.id_active_class = au.id_active_class_fk
    LEFT JOIN global.gapp_active_type aty  ON aty.active_type_id = acl.active_type_id_fk
`;

// Encerrada (2/3): as conferências estão no final_data; a temporária já foi limpa.
// O tipo do ativo não é coluna da auditoria: sai da classe (gapp_active_class.active_type_id_fk).
const AUDIT_SUMMARY_COLUMNS = `
    au.audit_id, au.user_open_id_fk, uo.name AS user_open_name,
    au.user_finish_id_fk, uf.name AS user_finish_name,
    au.unit_id_fk, un.unit_name, au.dep_id_fk, dp.dep_name,
    au.id_active_class_fk, acl.desc_active_class, acl.active_type_id_fk, aty.desc_active_type,
    au.quantity_active, au.date_open, au.date_finish, au.status_audit,
    CASE WHEN au.status_audit IN (2, 3)
         THEN COALESCE(JSON_LENGTH(au.final_data, '$.items'), 0)
         ELSE (SELECT COUNT(*) FROM global.gapp_active_audit_temp t WHERE t.audit_id_fk = au.audit_id)
    END AS quantity_registered
`;

// Período sobre `date_open`. `date_end` é inclusivo: pega o dia inteiro.
const AUDIT_FILTER_CLAUSES = {
    audit_id: 'au.audit_id = ?',
    status_audit: 'au.status_audit = ?',
    user_open_id_fk: 'au.user_open_id_fk = ?',
    unit_id_fk: 'au.unit_id_fk = ?',
    dep_id_fk: 'au.dep_id_fk = ?',
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
        ORDER BY au.status_audit, au.date_open DESC
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

/** Conferências da temporária com os nomes resolvidos. Params: [audit_id] */
function sqlListAuditItems() {
    return `
        SELECT t.audit_temp_id, t.audit_id_fk, t.active_id_fk, t.user_register_id_fk,
               ur.name AS user_register_name,
               t.identifier_type, t.identifier_value, t.asset_condition, t.lifecycle_status,
               t.additional_items, t.observations, t.date_register,
               t.is_transfer, t.transfer_reason,
               t.transfer_origin_dep_id_fk, dor.dep_name AS transfer_origin_dep_name, ${depPath('dor')} AS transfer_origin_dep_path,
               t.transfer_dep_id_fk,        dde.dep_name AS transfer_dep_name,        ${depPath('dde')} AS transfer_dep_path
        FROM global.gapp_active_audit_temp t
        LEFT JOIN global.gapp_user ur ON ur.user_id = t.user_register_id_fk${depJoin('dor', 't.transfer_origin_dep_id_fk')}${depJoin('dde', 't.transfer_dep_id_fk')}
        WHERE t.audit_id_fk = ?
        ORDER BY t.date_register, t.audit_temp_id
    `;
}

/** Nomes de usuários (para conferências antigas no final_data, que não guardavam o nome). */
function sqlListUserNames() {
    return 'SELECT user_id, name FROM global.gapp_user WHERE user_id IN (?)';
}

/**
 * Identificadores registrados em auditorias FINALIZADAS (exceto a atual),
 * lidos do `final_data` — a temporária é limpa na finalização.
 * Comparação sem caixa e sem espaços nas pontas. `pairs` = [[type, value], ...].
 */
function sqlIdentifierHistory(pairs) {
    const tuples = pairs.map(() => '(?, ?)').join(', ');
    return {
        sql: `
            SELECT au.audit_id AS audit_id_fk, j.active_id AS active_id_fk,
                   j.identifier_type, j.identifier_value
            FROM global.gapp_active_audit au,
                 JSON_TABLE(au.final_data, '$.items[*]' COLUMNS (
                     active_id        INT          PATH '$.active_id'        NULL ON ERROR,
                     identifier_type  VARCHAR(30)  PATH '$.identifier_type'  NULL ON ERROR,
                     identifier_value VARCHAR(150) PATH '$.identifier_value' NULL ON ERROR
                 )) j
            WHERE au.status_audit = 2
              AND au.audit_id <> ?
              AND (j.identifier_type, UPPER(TRIM(j.identifier_value))) IN (${tuples})
        `,
        build: auditId => [
            auditId,
            ...pairs.flatMap(([type, value]) => [type, String(value).trim().toUpperCase()]),
        ],
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

/** Setor atual do ativo — origem da transferência. */
function sqlGetActiveLocation() {
    return 'SELECT active_id, used_in FROM global.gapp_active WHERE active_id = ?';
}

/** Outro ativo da mesma auditoria com o mesmo identificador (valores gravados já sem espaços nas pontas). */
/**
 * Outro ativo que já usa o identificador: em qualquer auditoria aberta (temporária)
 * ou finalizada (final_data). Prefere a auditoria atual, para a mensagem certa.
 * Params: buildFindItemByIdentifierParams.
 */
function sqlFindItemByIdentifier() {
    return `
        SELECT active_id_fk, audit_id_fk FROM (
            SELECT t.active_id_fk, t.audit_id_fk
            FROM global.gapp_active_audit_temp t
            WHERE t.identifier_type = ? AND t.identifier_value = ? AND t.active_id_fk <> ?
            UNION ALL
            SELECT j.active_id, au.audit_id
            FROM global.gapp_active_audit au,
                 JSON_TABLE(au.final_data, '$.items[*]' COLUMNS (
                     active_id        INT          PATH '$.active_id'        NULL ON ERROR,
                     identifier_type  VARCHAR(30)  PATH '$.identifier_type'  NULL ON ERROR,
                     identifier_value VARCHAR(150) PATH '$.identifier_value' NULL ON ERROR
                 )) j
            WHERE au.status_audit = 2
              AND j.identifier_type = ? AND UPPER(TRIM(j.identifier_value)) = UPPER(?) AND j.active_id <> ?
        ) owners
        ORDER BY audit_id_fk = ? DESC
        LIMIT 1
    `;
}

function buildFindItemByIdentifierParams(auditId, type, value, ignoreActiveId) {
    return [type, value, ignoreActiveId, type, value, ignoreActiveId, auditId];
}

/** Colunas gravadas na conferência, na ordem dos parâmetros. */
const ITEM_COLUMNS = [
    'identifier_type', 'identifier_value', 'asset_condition', 'lifecycle_status',
    'additional_items', 'observations',
    'is_transfer', 'transfer_reason',
    'transfer_origin_dep_id_fk', 'transfer_dep_id_fk',
];

function itemParams(data) {
    return ITEM_COLUMNS.map(column => {
        if (column === 'additional_items') return data.additional_items != null ? JSON.stringify(data.additional_items) : null;
        if (column === 'is_transfer') return data.is_transfer ? 1 : 0;
        return data[column] ?? null;
    });
}

function sqlInsertAuditItem() {
    return `
        INSERT INTO global.gapp_active_audit_temp
            (audit_id_fk, active_id_fk, user_register_id_fk, ${ITEM_COLUMNS.join(', ')})
        VALUES (?, ?, ?, ${ITEM_COLUMNS.map(() => '?').join(', ')})
    `;
}

function buildInsertAuditItemParams(auditId, data) {
    return [auditId, data.active_id_fk, data.user_register_id_fk, ...itemParams(data)];
}

/** Editar a conferência registra quem fez a última alteração e quando. */
function sqlUpdateAuditItem() {
    return `
        UPDATE global.gapp_active_audit_temp
        SET user_register_id_fk = ?, ${ITEM_COLUMNS.map(column => `${column} = ?`).join(', ')}, date_register = NOW()
        WHERE audit_id_fk = ? AND active_id_fk = ?
    `;
}

function buildUpdateAuditItemParams(auditId, data) {
    return [data.user_register_id_fk, ...itemParams(data), auditId, data.active_id_fk];
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

/** Ativo não previsto incluído: nova fotografia e quantidade. Params: [initial_data, quantity_active, audit_id] */
function sqlUpdateInitialData() {
    return 'UPDATE global.gapp_active_audit SET initial_data = ?, quantity_active = ? WHERE audit_id = ? AND status_audit IN (0, 1)';
}

/** Relê o que foi gravado (mesma transação) para conferir antes de limpar a temporária. */
function sqlGetFinalData() {
    return 'SELECT status_audit, final_data FROM global.gapp_active_audit WHERE audit_id = ?';
}

/** Limpa as conferências da temporária — só depois do final_data conferido. */
function sqlDeleteAuditItems() {
    return 'DELETE FROM global.gapp_active_audit_temp WHERE audit_id_fk = ?';
}

module.exports = {
    sqlListActivesForAudit,
    sqlFindUnit,
    sqlFindDepartment,
    sqlFindActiveClass,
    sqlFindActiveType,
    sqlInsertAudit,
    buildInsertAuditParams,
    sqlListAudits,
    sqlCountAudits,
    sqlGetAuditById,
    sqlListAuditItems,
    sqlListUserNames,
    sqlIdentifierHistory,
    sqlLockAudit,
    sqlGetAuditItem,
    sqlGetActiveLocation,
    sqlFindItemByIdentifier,
    buildFindItemByIdentifierParams,
    sqlInsertAuditItem,
    buildInsertAuditItemParams,
    sqlUpdateAuditItem,
    buildUpdateAuditItemParams,
    sqlUpdateAuditStatus,
    sqlCloseAudit,
    sqlGetFinalData,
    sqlUpdateInitialData,
    sqlDeleteAuditItems,
};
