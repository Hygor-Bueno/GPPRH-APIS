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
    WHERE nf_id = ?;
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
        data.nf_id ?? null
    ]
}

function sqlListNF(filters = {}) {
    const limit = Number(filters.limit) || 20;
    const page = Number(filters.page) || 1;
    const offset = (page - 1) * limit;

    const sql = `
    select nf_id, number_nf, dt_issue, dt_delivery, hr_exit, nf_key, expen_id_fk from global.gapp_nf order by nf_id desc LIMIT ? OFFSET ?
    `

    return { sql, params: [limit, offset] };
}

module.exports = {
    sqlListNF,
    sqlInsertNF,
    sqlUpdateNF,
    buildInserNfParams,
    buildUpdateNfParams
}