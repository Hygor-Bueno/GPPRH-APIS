function sqlListInfraction() {
    return `SELECT * FROM global.gapp_infractions`
}

function sqlListInfractionById() {
    return `SELECT * FROM global.gapp_infractions WHERE infraction_id = ?`
}

function sqlCreateInfraction() {
    return `
        INSERT INTO global.gapp_infractions (
            infraction, gravity, points, status_infractions
        ) VALUES (?, ?, ?, ?)`
}

function buildCreateInfraction(data) {
    return [
        data.infraction ?? null,
        data.gravity ?? null,
        data.points ?? null,
        data.status_infractions ?? null,
    ]

}

function sqlUpdateInfraction() {
    return `
        UPDATE global.gapp_infractions 
            SET infraction = ?, gravity = ?, points = ?, status_infractions = ?
        WHERE infraction_id = ?`
}

function buildUpdateInfraction(data) {
    return [
        data.infraction ?? null,
        data.gravity ?? null,
        data.points ?? null,
        data.status_infractions ?? null,
        data.infraction_id ?? null
    ]
}


module.exports = {
    sqlListInfraction,
    sqlListInfractionById,
    sqlCreateInfraction,
    sqlUpdateInfraction,
    buildCreateInfraction,
    buildUpdateInfraction,
}