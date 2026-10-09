function sqlListInventory() {
    return `SELECT * FROM global.mg_inventories`
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

module.exports = {
    sqlListInventory, sqlInsertInventory, sqlUpdateInventory,
    buildInsertInventory, buildUpdateInventory,
    sqlGetConfigs, sqlGetNumberReleasesForMonth
}