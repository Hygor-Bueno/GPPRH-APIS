/**
 * @fileoverview Consultas SQL puras para lojas GAPP (gapp_store).
 *
 * Sem execução, sem I/O.
 *
 * @module modules/global/repositories/mysql/gapp-store.queries
 */

const STORE_FILTER_CLAUSES = {
    store_id: 'store_id = ?',
    cnpj: 'cnpj = ?',
    name: 'name LIKE ?',
    city: 'city LIKE ?',
    state: 'state = ?',
    status_store: 'status_store = ?',
};

const STORE_LIKE_FIELDS = new Set(['name', 'city']);

function buildStoreFilters(filters = {}) {
    const conditions = [];
    const params = [];

    for (const [key, clause] of Object.entries(STORE_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(STORE_LIKE_FIELDS.has(key) ? `%${filters[key]}%` : filters[key]);
        }
    }

    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function sqlListStores(filters = {}) {
    const { where, params } = buildStoreFilters(filters);
    const limit = Number(filters.limit) || 20;
    const page = Number(filters.page) || 1;
    const offset = (page - 1) * limit;

    const sql = `
        SELECT store_id, cnpj, name, street, district, city, state, number, zip_code, complement, status_store
        FROM global.gapp_store
        ${where}
        ORDER BY name
        LIMIT ? OFFSET ?
    `;
    return { sql, params: [...params, limit, offset] };
}

function sqlCountStores(filters = {}) {
    const { where, params } = buildStoreFilters(filters);
    return { sql: `SELECT COUNT(*) AS total FROM global.gapp_store ${where}`, params };
}

function sqlGetStoreById() {
    return `
        SELECT store_id, cnpj, name, street, district, city, state, number, zip_code, complement, status_store
        FROM global.gapp_store
        WHERE store_id = ?
    `;
}

function sqlCheckStoreExists() {
    return 'SELECT store_id FROM global.gapp_store WHERE store_id = ?';
}

function sqlInsertStore() {
    return `
        INSERT INTO global.gapp_store
            (cnpj, name, street, district, city, state, number, zip_code, complement, status_store)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
}

function buildInsertStoreParams(data) {
    return [
        data.cnpj ?? null,
        data.name,
        data.street,
        data.district ?? null,
        data.city,
        data.state,
        data.number,
        data.zip_code,
        data.complement ?? null,
        data.status_store ?? 1,
    ];
}

function sqlUpdateStore() {
    return `
        UPDATE global.gapp_store
        SET cnpj = ?, name = ?, street = ?, district = ?, city = ?, state = ?,
            number = ?, zip_code = ?, complement = ?, status_store = ?
        WHERE store_id = ?
    `;
}

function buildUpdateStoreParams(data, storeId) {
    return [
        data.cnpj ?? null,
        data.name,
        data.street,
        data.district ?? null,
        data.city,
        data.state,
        data.number,
        data.zip_code,
        data.complement ?? null,
        data.status_store ?? 1,
        storeId,
    ];
}

/** Exclusão lógica: nunca DELETE FROM — só desativa via status_store. */
function sqlSoftDeleteStore() {
    return 'UPDATE global.gapp_store SET status_store = 0 WHERE store_id = ?';
}

module.exports = {
    sqlListStores, sqlCountStores, sqlGetStoreById,
    sqlCheckStoreExists,
    sqlInsertStore, buildInsertStoreParams,
    sqlUpdateStore, buildUpdateStoreParams,
    sqlSoftDeleteStore,
};
