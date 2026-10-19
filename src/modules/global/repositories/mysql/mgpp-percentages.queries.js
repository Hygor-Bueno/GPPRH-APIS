function sqlListPercentage() {
    return `SELECT * FROM global.mg_percentage`
}

function sqlInsertPercentage() {
    return `INSERT INTO global.mg_percentage (
                id_user_fk, 
                costcenter_code, 
                branch_code,
                value_percentage_sale, 
                value_percentage_loss, 
                value_sector_percentage 
            ) VALUES (
                ?, ?, ?, ?, ?, ?
            )`
};

function sqlGetTotalPercentageSector(branchCode, costcenterCode) {
    return `SELECT sum(value_sector_percentage) as total FROM global.mg_percentage WHERE branch_code = ${branchCode} AND costcenter_code != ${costcenterCode}`
}

function buildInsertPercentage(data) {
    return [
        data.id_user_fk ?? null,
        data.costcenter_code ?? null,
        data.branch_code ?? null,
        data.value_percentage_sale ?? null,
        data.value_percentage_loss ?? null,
        data.value_sector_percentage ?? null
    ]
}

function sqlUpdatePercentage() {
    return `UPDATE global.mg_percentage SET 
                id_user_fk = ?,
                costcenter_code = ?,             
                branch_code = ?,
                value_percentage_sale = ?,
                value_percentage_loss = ?,
                value_sector_percentage = ?
            WHERE id_percentage = ?`
}

function buildUpdatePercentage(data, id) {
    return [
        data.id_user_fk ?? null,
        data.costcenter_code ?? null,
        data.branch_code ?? null,
        data.value_percentage_sale ?? null,
        data.value_percentage_loss ?? null,
        data.value_sector_percentage ?? null,
        id ?? null
    ]
}


module.exports = { sqlListPercentage, sqlInsertPercentage, sqlUpdatePercentage, buildInsertPercentage, buildUpdatePercentage, sqlGetTotalPercentageSector }
