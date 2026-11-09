/**
 * @fileoverview Consultas SQL puras para termos de ativo GAPP (gapp_asset_term).
 *
 * Sem execução, sem I/O.
 *
 * @module modules/global/repositories/mysql/gapp-asset-term.queries
 */

// Tipo do ativo pelo cadastro complementar — mesma regra do formulário de ativo
// (veículo / smartphone / cartão SIM; sem complemento = ativo geral).
const ASSET_TYPE_SQL = `
    CASE
        WHEN a.is_vehicle = 1 OR v.active_id_fk IS NOT NULL THEN 'vehicle'
        WHEN sp.active_id_fk IS NOT NULL THEN 'smartphone'
        WHEN sm.active_id_fk IS NOT NULL THEN 'sim'
        ELSE 'generic'
    END
`;

const ASSET_TERM_COLUMNS = `
    t.asset_term_id, t.reponsible_name, t.created_by, t.active_id_fk,
    t.file_id_fk, t.file_name, t.created_at, t.updated_at,
    a.brand, a.model, ac.desc_active_class,
    ${ASSET_TYPE_SQL} AS asset_type,
    v.license_plates, sp.imei_1, sm.number AS sim_number, sm.serial_number AS sim_serial_number
`;

// Complementos 1:1 com o ativo (o cadastro de ativo grava no máximo um de cada).
const ASSET_TERM_FROM = `
    FROM global.gapp_asset_term t
    LEFT JOIN global.gapp_active a ON a.active_id = t.active_id_fk
    LEFT JOIN global.gapp_active_class ac ON ac.id_active_class = a.id_active_class_fk
    LEFT JOIN global.gapp_vehicle v ON v.active_id_fk = t.active_id_fk
    LEFT JOIN global.gapp_smartphone sp ON sp.active_id_fk = t.active_id_fk
    LEFT JOIN global.gapp_sim sm ON sm.active_id_fk = t.active_id_fk
`;

// Período sobre `created_at`. `date_end` é inclusivo: pega o dia inteiro.
const ASSET_TERM_FILTER_CLAUSES = {
    asset_term_id: 't.asset_term_id = ?',
    active_id_fk: 't.active_id_fk = ?',
    asset_type: `${ASSET_TYPE_SQL} = ?`,
    reponsible_name: 't.reponsible_name LIKE ?',
    date_start: 't.created_at >= ?',
    date_end: 't.created_at < DATE_ADD(?, INTERVAL 1 DAY)',
};

const ASSET_TERM_LIKE_FIELDS = new Set(['reponsible_name']);

// Telefone sem máscara: "(11) 98888-7777" e "11988887777" acham a mesma linha
const digitsOnly = column => `REPLACE(REPLACE(REPLACE(REPLACE(${column}, '(', ''), ')', ''), '-', ''), ' ', '')`;
const like = value => `%${value}%`;

/*
 * Filtros pelos dados do ativo do termo (busca por parte do valor). Usam os
 * complementos já ligados no FROM (v, sp, sm); a linha do smartphone vem dos
 * chips vinculados a ele, por isso o EXISTS. `params` monta o valor de cada `?`.
 */
const ASSET_DATA_FILTER_CLAUSES = {
    license_plates: { clause: 'v.license_plates LIKE ?', params: value => [like(value)] },
    imei: { clause: '(sp.imei_1 LIKE ? OR sp.imei_2 LIKE ?)', params: value => [like(value), like(value)] },
    number: {
        clause: `(${digitsOnly('sm.number')} LIKE ?
              OR EXISTS (SELECT 1 FROM global.gapp_sim_biding b
                          JOIN global.gapp_sim chip ON chip.sim_id IN (b.sim_1_id_fk, b.sim_2_id_fk)
                          WHERE b.sim_biding_id = sp.sim_biding_id_fk AND ${digitsOnly('chip.number')} LIKE ?))`,
        params: value => {
            const digits = like(String(value).replace(/\D/g, ''));
            return [digits, digits];
        },
    },
    serial_number: { clause: '(sp.serial_number LIKE ? OR sm.serial_number LIKE ?)', params: value => [like(value), like(value)] },
};

function buildAssetTermFilters(filters = {}) {
    const conditions = [];
    const params = [];

    for (const [key, clause] of Object.entries(ASSET_TERM_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(ASSET_TERM_LIKE_FIELDS.has(key) ? `%${filters[key]}%` : filters[key]);
        }
    }

    for (const [key, { clause, params: build }] of Object.entries(ASSET_DATA_FILTER_CLAUSES)) {
        if (filters[key] != null && String(filters[key]).trim() !== '') {
            conditions.push(clause);
            params.push(...build(String(filters[key]).trim()));
        }
    }

    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function sqlListAssetTerms(filters = {}) {
    const { where, params } = buildAssetTermFilters(filters);
    const limit = Number(filters.limit) || 20;
    const page = Number(filters.page) || 1;
    const offset = (page - 1) * limit;

    const sql = `
        SELECT ${ASSET_TERM_COLUMNS}
        ${ASSET_TERM_FROM}
        ${where}
        ORDER BY t.created_at DESC, t.asset_term_id DESC
        LIMIT ? OFFSET ?
    `;
    return { sql, params: [...params, limit, offset] };
}

function sqlCountAssetTerms(filters = {}) {
    const { where, params } = buildAssetTermFilters(filters);
    return { sql: `SELECT COUNT(*) AS total ${ASSET_TERM_FROM} ${where}`, params };
}

function sqlGetAssetTermById() {
    return `
        SELECT ${ASSET_TERM_COLUMNS}
        ${ASSET_TERM_FROM}
        WHERE t.asset_term_id = ?
    `;
}

function sqlCheckActiveExists() {
    return 'SELECT active_id FROM global.gapp_active WHERE active_id = ?';
}

/** Quantos OUTROS termos apontam para o mesmo arquivo (o FileService deduplica por hash). */
function sqlCountFileReferences() {
    return 'SELECT COUNT(*) AS total FROM global.gapp_asset_term WHERE file_id_fk = ? AND asset_term_id <> ?';
}

function sqlInsertAssetTerm() {
    return `
        INSERT INTO global.gapp_asset_term
            (reponsible_name, created_by, active_id_fk, file_id_fk, file_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
    `;
}

function buildInsertAssetTermParams(data) {
    return [
        data.reponsible_name,
        data.created_by,
        data.active_id_fk,
        data.file_id_fk,
        data.file_name,
    ];
}

function sqlUpdateAssetTerm() {
    return `
        UPDATE global.gapp_asset_term
        SET reponsible_name = ?, active_id_fk = ?, file_id_fk = ?, file_name = ?, updated_at = NOW()
        WHERE asset_term_id = ?
    `;
}

function buildUpdateAssetTermParams(data, assetTermId) {
    return [
        data.reponsible_name,
        data.active_id_fk,
        data.file_id_fk,
        data.file_name,
        assetTermId,
    ];
}

/** A tabela não tem coluna de status: exclusão física da linha. */
function sqlDeleteAssetTerm() {
    return 'DELETE FROM global.gapp_asset_term WHERE asset_term_id = ?';
}

module.exports = {
    sqlListAssetTerms, sqlCountAssetTerms, sqlGetAssetTermById,
    sqlCheckActiveExists, sqlCountFileReferences,
    sqlInsertAssetTerm, buildInsertAssetTermParams,
    sqlUpdateAssetTerm, buildUpdateAssetTermParams,
    sqlDeleteAssetTerm,
};
