
function sqlListMovimentation() {
    return `SELECT DISTINCT(mv.mov_id), ac.model, ac.brand, mv.active_id_fk, mv.unit_id_fk, un.unit_name,
    			   ac.number_nf, mv.destiny, mv.internal, mv.sale_value, mv.status_mov, vh.license_plates  
			FROM global.gapp_movimentation mv
				JOIN global.gapp_active ac ON (mv.active_id_fk = ac.active_id)
				JOIN global.gapp_units un ON (ac.units_id_fk = un.unit_id)
                JOIN global.gapp_vehicle vh ON (mv.active_id_fk = vh.active_id_fk)
            ORDER BY mov_id DESC`
}

function sqlListMovimentationById() {
    return `SELECT * FROM global.gapp_movimentation WHERE mov_id = ?`
}

function sqlInsertMovimentation() {
    return `INSERT INTO global.gapp_movimentation (
	            destiny, sale_value, number_nf, status_mov, internal, active_id_fk, user_id_fk, sub_dep_id_fk, unit_id_fk
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
}

function buildInsertMovimentation(data) {
    return [
        data.destiny ?? null,
        data.sale_value ?? null,
        data.number_nf ?? null,
        data.status_mov ?? null,
        data.internal ?? null,
        data.active_id_fk ?? null,
        data.user_id_fk ?? null,
        data.sub_dep_id_fk ?? null,
        data.unit_id_fk ?? null,
    ]
}

function sqlUpdateMovimentation() {
    return `UPDATE global.gapp_movimentation 
	            SET destiny = ?, sale_value = ?, number_nf = ?, status_mov = ?, internal = ?, active_id_fk = ?, user_id_fk = ?, sub_dep_id_fk = ?, unit_id_fk = ?
		    WHERE mov_id = ?`
}

function sqlCountMovimentation() {
    return `SELECT COUNT(*) AS quantity FROM global.gapp_movimentation WHERE status_mov = 1 AND internal = 0 AND active_id_fk = ?`
}

function buildUpdateMovimentation(data, mov_id) {
    return [
        data.destiny ?? null,
        data.sale_value ?? null,
        data.number_nf ?? null,
        data.status_mov ?? null,
        data.internal ?? null,
        data.active_id_fk ?? null,
        data.user_id_fk ?? null,
        data.sub_dep_id_fk ?? null,
        data.unit_id_fk ?? null,
        mov_id,
    ]
}

module.exports = {
    sqlListMovimentation,
    sqlListMovimentationById,
    sqlInsertMovimentation,
    sqlUpdateMovimentation,
    sqlCountMovimentation,
    buildInsertMovimentation,
    buildUpdateMovimentation,
}