function sqlListPercentage(){
    return `SELECT * FROM global.mg_percentage`
}

function sqlInsertPercentage(){
    return `INSERT INTO global.mg_percentage (
                id_user_fk, id_award_fk, costcenter_code, costcenter_name, 
                branch_code, value_percentage_sale, value_percentage_loss, 
                value_sector_percentage 
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?
            )`
};

function buildInsertPercentage(data){
    data.id_user_fk ?? null,
    data.id_award_fk ?? null,
    data.costcenter_code ?? null,
    data.costcenter_name ?? null,
    data.branch_code ?? null,
    data.branch_name ?? null,
    data.value_percentage_sale ?? null,
    data.value_percentage_loss ?? null,
    data.value_sector_percentage ?? null
}

function sqlUpdatePercentage(){
    return `UPDATE global.mg_percentage SET 
                id_user_fk = ?,
                id_award_fk = ?,
                costcenter_code = ?,
                costcenter_name = ?,
                branch_code = ?,
                value_percentage_sale = ?,
                value_percentage_loss = ?,
                value_sector_percentage = ?
            WHERE id_percentage = ?`
}

function buildUpdatePercentage(data, id){
    data.id_user_fk ?? null,
    data.id_award_fk ?? null,
    data.costcenter_code ?? null,
    data.costcenter_name ?? null,
    data.branch_code ?? null,
    data.branch_name ?? null,
    data.value_percentage_sale ?? null,
    data.value_percentage_loss ?? null,
    data.value_sector_percentage ?? null,
    id ?? null
}


module.exports = { sqlListPercentage, sqlInsertPercentage, sqlUpdatePercentage, buildInsertPercentage, buildUpdatePercentage}
