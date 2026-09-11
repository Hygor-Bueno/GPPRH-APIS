function sqlInsertNF() {
    return `INSERT INTO global.gapp_nf (number_nf, dt_issue, dt_delivery, hr_exit, nf_key, expen_id_fk, user_id_fk ) values (? ,? ,? ,? ,? ,?, ?);`
}

function buildInserNfParams(data) {
    return [
        data.number_nf ?? null,
        data.dt_issue ?? null,
        data.dt_delivery ?? null,
        data.hr_exit ?? null,
        data.nf_key ?? null,
        data.expen_id_fk ?? null,
        data.user_id_fk ?? null,
    ]
}

function sqlUpdateNF() {
    return `
    UPDATE global.gapp_nf 
	    SET number_nf = ?, dt_issue = ?, dt_delivery = ?, hr_exit = ?, nf_key = ?, expen_id_fk = ?, user_id_fk = ?
    WHERE expen_id_fk = ?;
    `
}

function buildUpdateNfParams(data) {
    return [
        data.number_nf ?? null,
        data.dt_issue ?? null,
        data.dt_delivery ?? null,
        data.hr_exit ?? null,
        data.nf_key ?? null,
        data.expen_id_fk ?? null,
        data.user_id_fk ?? null,
        data.expen_id_fk ?? null,
    ]
}

function sqlListNF(filters = {}) {
    const limit = Number(filters.limit) || 20;
    const page = Number(filters.page) || 1;
    const offset = (page - 1) * limit;

    const sql = `
        WITH gapp_nf AS (
            SELECT 
                *,
                ROW_NUMBER() OVER(PARTITION BY number_nf ORDER BY nf_id DESC) as num_nf
            FROM global.gapp_nf
        )
            SELECT number_nf, dt_issue, dt_delivery, hr_exit, nf_key, expen_id_fk, (
                SELECT SUM(ex.total_value) 
                FROM global.gapp_nf nf2 
                    JOIN global.gapp_expenses_register ex 
                        ON nf2.expen_id_fk = ex.expen_id 
                    WHERE nf2.nf_key = nf.nf_key
            ) as total  
                FROM gapp_nf nf
            WHERE num_nf = 1 
                ORDER BY nf_id DESC 
            LIMIT ? OFFSET ?
    `
    return { sql, params: [limit, offset] };
}

function sqlCountNFRegistered() {
    return `WITH gapp_nf AS (
                SELECT 
                    *,
                    ROW_NUMBER() OVER(PARTITION BY number_nf ORDER BY nf_id DESC) as num_nf
                FROM global.gapp_nf
            )SELECT count(*) as total
                FROM gapp_nf 
            WHERE num_nf = 1 `
}

function sqlListCouponsDisassociated() {
    return `SELECT 
                ex.expen_id, ex.coupon_number, ex.total_value, tp.description_type
            FROM global.gapp_expenses_register ex
                LEFT JOIN global.gapp_nf nf ON ex.expen_id = nf.expen_id_fk
                JOIN global.gapp_expenses_type tp ON ex.exp_type_id_fk = tp.exp_type_id
            WHERE nf.expen_id_fk IS NULL
                AND ex.coupon_number IS NOT NULL
                AND ex.coupon_number > 0
                AND ex.status_expen = 1
                AND ex.exp_type_id_fk = 1
            ORDER BY ex.expen_id DESC`
}

function sqlListNFById(id) {
    return `select number_nf, dt_issue, dt_delivery, hr_exit, nf_key, expen_id_fk from global.gapp_nf where number_nf = ${id}`
}

function sqlListCuponsAssociated(nf_key) {
    return `SELECT 
                ex.expen_id, ex.coupon_number, tp.description_type, ex.total_value 
            FROM global.gapp_nf nf 
                JOIN global.gapp_expenses_register ex ON nf.expen_id_fk = ex.expen_id
                JOIN global.gapp_expenses_type tp ON ex.exp_type_id_fk = tp.exp_type_id
            WHERE nf_key = "${nf_key}";
    `
}

function sqlDeleteNFById(id) {
    return `DELETE FROM global.gapp_nf where expen_id_fk = ${id}`
}

module.exports = {
    sqlListNF,
    sqlListNFById,
    sqlListCuponsAssociated,
    sqlListCouponsDisassociated,
    sqlInsertNF,
    sqlUpdateNF,
    sqlDeleteNFById,
    sqlCountNFRegistered,
    buildInserNfParams,
    buildUpdateNfParams
}