function sqlListAwards() {
    return `SELECT * FROM global.mg_awards`
}

function sqlInsertAward() {
    return `INSERT INTO global.mg_awards (total_value_award, category_award) VALUES (?, ?)`
}


function sqlUpdateAward() {
    return `UPDATE global.mg_awards SET total_value_award = ?, category_award = ? WHERE id_award = ?`
}

function buildUpdateAward(data) {
    return [
        data.total_value_award ?? null,
        data.category_award ?? null,
        data.id_award ?? null
    ]
}

module.exports = { sqlListAwards, sqlInsertAward, sqlUpdateAward, buildUpdateAward}