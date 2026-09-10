
class NfRepositoryPort {

    /** @param {object} filters */
    listNf(filters) { throw new Error('Not implemented'); }

    /** @param {object} id */
    listNFById(id) { throw new Error('Not implemented'); }

    listCoupon() { throw new Error('Not implemented'); }

    /** @param {object} payload */
    createNf(payload) { throw new Error('Not implemented'); }

    /** @param {object} payload */
    updateNf(id, payload) { throw new Error('Not implemented'); }

     /** @param {object} id */
    deleteNF(id) { throw new Error('Not implemented'); }
}

module.exports = { NfRepositoryPort }