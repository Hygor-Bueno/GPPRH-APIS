
class InfractionRepositoryPort {

    listInfraction() { throw new Error('Not implemented'); }

    /** @param {object} id */
    listInfractionById(id) { throw new Error('Not implemented'); }

    /** @param {object} payload */
    insertInfraction(payload) { throw new Error('Not implemented'); }

    /** @param {object} id payload */
    updateInfraction(id, payload) { throw new Error('Not implemented'); }

}

module.exports = { InfractionRepositoryPort }