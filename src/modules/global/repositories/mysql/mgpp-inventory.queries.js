const INVENTORY_FILTER_CLAUSES = {
    branch_code: 'branch_code = ?',
    costcenter_code: 'costcenter_code = ?',
    status_inventory: 'status_inventory = ?',
    has_audit: 'has_audit = ?'
};

function buildInventoryFilters(filters = {}) {
    const conditions = [];
    const params = [];

    for (const [key, clause] of Object.entries(INVENTORY_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(filters[key]);
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
                ORDER BY status_inventory LIMIT ? OFFSET ?
    `
    return { sql, params: [...params, limit, offset] };
}

function sqlGetConfigs(branch, costcenter) {
    return `SELECT quantity_for_month, branch_code, costcenter_code FROM global.mg_inventory_configs WHERE branch_code = '${branch}' AND costcenter_code = '${costcenter}'`
}

function sqlGetNumberReleasesForMonth(month, branch, costcenter) {
    return `SELECT COUNT(*) AS quantity FROM global.mg_inventories WHERE created_at like '%${month}%' AND branch_code = '${branch}' AND costcenter_code = '${costcenter}' AND status_inventory != 2`
}

function sqlInsertInventory() {
    return `INSERT INTO global.mg_inventories (
                id_user_fk,
                expected_quantity,
                costcenter_code,
                branch_code,
                status_inventory,
                has_audit,
                quantity_performed
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
}

function buildInsertInventory(data) {
    return [
        data.id_user_fk ?? null,
        data.expected_quantity ?? null,
        data.costcenter_code ?? null,
        data.branch_code ?? null,
        data.status_inventory ?? null,
        data.has_audit ?? null,
        data.quantity_performed ?? null
    ]
}

function sqlUpdateInventory() {
    return `UPDATE global.mg_inventories SET     
                id_user_fk = ?,
                expected_quantity = ?,
                costcenter_code = ?,
                branch_code = ?,
                quantity_performed = ?,
                status_inventory = ?,
                has_audit = ?
            WHERE id_inventory = ?`
}

function buildUpdateInventory(data, id) {
    return [
        data.id_user_fk ?? null,
        data.expected_quantity ?? null,
        data.costcenter_code ?? null,
        data.branch_code ?? null,
        data.quantity_performed ?? null,
        data.status_inventory ?? null,
        data.has_audit ?? null,
        id ?? null
    ]
}

function sqlCountInventoryRegistered() {
    return `SELECT COUNT(*) as total FROM global.mg_inventories`
}

function sqlValidateInventoryStatus(id) {
    return `SELECT status_inventory FROM global.mg_inventories WHERE id_inventory = ${id}`
}

module.exports = {
    sqlListInventory, sqlInsertInventory, sqlUpdateInventory,
    buildInsertInventory, buildUpdateInventory, sqlValidateInventoryStatus,
    sqlGetConfigs, sqlGetNumberReleasesForMonth, sqlCountInventoryRegistered,
}