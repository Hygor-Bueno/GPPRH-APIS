function sqlListInventoryConfigs() {
    return `SELECT * FROM global.mg_inventory_configs`
}

function sqlInsertInventoryConfig() {
    return `INSERT INTO global.mg_inventory_configs (
                id_user_fk,
                costcenter_code,
                branch_code,
                quantity_for_month
            ) VALUES (?, ?, ?, ?)`
}

function buildInsertInventoryConfig(data) {
    return [
        data.id_user_fk ?? null,
        data.costcenter_code ?? null,
        data.branch_code ?? null,
        data.quantity_for_month ?? null
    ]
}

function sqlUpdateInventoryConfig() {
    return `UPDATE global.mg_inventory_configs 
            SET 
                id_user_fk = ?,
                costcenter_code = ?,
                branch_code = ?,
                quantity_for_month = ?
            WHERE id_inventory_config = ?`
}

function buildUpdateInventoryConfig(data, id) {
    return [
        data.id_user_fk ?? null,
        data.costcenter_code ?? null,
        data.branch_code ?? null,
        data.quantity_for_month ?? null,
        id ?? null
    ]
}

module.exports = { sqlListInventoryConfigs, sqlInsertInventoryConfig, sqlUpdateInventoryConfig, buildInsertInventoryConfig, buildUpdateInventoryConfig }