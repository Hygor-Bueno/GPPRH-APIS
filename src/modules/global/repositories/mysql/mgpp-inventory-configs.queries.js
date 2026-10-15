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
            params.push(filters[key]);
        }
    }

    return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function sqlListInventoryConfigs(filters = {}) {
    const { where, params } = buildInventoryFilters(filters)
    const sql = `SELECT
                    id_inventory_config,
                    costcenter_code,
                    branch_code,
                    quantity_for_month
                FROM global.mg_inventory_configs
                ${where}`;

    return { sql: sql, params: params }
}
function sqlListInventoryConfigsPendings() {
    const currentDate = new Date();
    const initialDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const finalDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    const formatDate = (date) => date.toISOString().split("T")[0];

    return `
        SELECT
            mg.id_inventory_config,
            mg.costcenter_code,
            mg.branch_code,
            mg.quantity_for_month,
            (
                mg.quantity_for_month - (
                    SELECT COUNT(*)
                    FROM global.mg_inventories AS inv
                    WHERE inv.created_at >= '${formatDate(initialDate)}'
                      AND inv.created_at < '${formatDate(finalDate)}'
                      AND inv.costcenter_code = mg.costcenter_code
                      AND inv.branch_code = mg.branch_code
                      AND inv.status_inventory != 2
                )
            ) AS quantity_pending
        FROM global.mg_inventory_configs AS mg;
    `;
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

module.exports = { sqlListInventoryConfigs, sqlInsertInventoryConfig, sqlUpdateInventoryConfig, buildInsertInventoryConfig, buildUpdateInventoryConfig, sqlListInventoryConfigsPendings }