class MovimentationRepositoryPort {

    listMovimentation() { throw new Error('Not implemented'); }

    /** @param {object} id */
    listMovimentationById(id) { throw new Error('Not implemented'); }

    /** @param {object} payload */
    insertMovimentation(payload, activeData) { throw new Error('Not implemented'); }

    /** @param {object} id payload */
    updateMovimentation(id, payload) { throw new Error('Not implemented'); }

    /** @param {object} id */
    findValueActive(id) { throw new Error('Not implemented'); }

}

module.exports = { MovimentationRepositoryPort }