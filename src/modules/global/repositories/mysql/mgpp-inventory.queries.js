const INVENTORY_FILTER_CLAUSES = {
    branch_code: 'branch_code = ?',
    costcenter_code: 'costcenter_code = ?'
};

function buildInventoryFilters(filters = {}) {
    const conditions = [];
    const params = [];

    for (const [key, clause] of Object.entries(INVENTORY_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(key === 'description' ? `%${filters[key]}%` : filters[key]);
        }
    }

    if (filters.date_start) { conditions.push('DATE(created_at) >= ?'); params.push(filters.date_start); }
    if (filters.date_end) { conditions.push('DATE(created_at) <= ?'); params.push(filters.date_end); }

    return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function sqlListInventory(filters = {}) {
    const { where, params } = buildInventoryFilters(filters)
    const limit = Number(filters.limit) || 20;
    const page = Number(filters.page) || 1;
    const offset = (page - 1) * limit;
    const sql = `SELECT * FROM global.mg_inventories
                ${where}
                ORDER BY id_inventory DESC 
                    LIMIT ? OFFSET ?
    `
    return { sql, params: [...params, limit, offset] };
}

function sqlGetConfigs(id) {
    return `SELECT quantity_for_month, branch_code, costcenter_code FROM global.mg_inventory_configs WHERE id_inventory_config = ${id}`
}

function sqlGetNumberReleasesForMonth(month, id) {
    return `SELECT COUNT(*) AS quantity FROM global.mg_inventories WHERE created_at like '%${month}%' AND id_inventory_config = ${id}`
}


function sqlInsertInventory() {
    return `INSERT INTO global.mg_inventories (
                id_user_fk,
                id_inventory_config,
                costcenter_code,
                branch_code
            ) VALUES (?, ?, ?, ?)`
}

function buildInsertInventory(data) {
    return [
        data.id_user_fk ?? null,
        data.id_inventory_config ?? null,
        data.costcenter_code ?? null,
        data.branch_code ?? null
    ]
}

function sqlUpdateInventory() {
    return `UPDATE global.mg_inventories SET 
                id_user_fk = ?,
                id_inventory_config = ?,
                costcenter_code = ?,
                branch_code = ?
            WHERE id_inventory = ?`
}

function buildUpdateInventory(data, id) {
    return [
        data.id_user_fk ?? null,
        data.id_inventory_config ?? null,
        data.costcenter_code ?? null,
        data.branch_code ?? null,
        id ?? null
    ]
}
function sqlCountInventoryRegistered() {
    return `SELECT COUNT(*) as total FROM global.mg_inventories`
}

module.exports = {
    sqlListInventory, sqlInsertInventory, sqlUpdateInventory,
    buildInsertInventory, buildUpdateInventory,
    sqlGetConfigs, sqlGetNumberReleasesForMonth, sqlCountInventoryRegistered
}