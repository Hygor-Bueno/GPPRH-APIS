class MgppInventoryRepositoryPorts {
    /**
    * @param {number} accessCode - `_user.id` do usuário autenticado.
    */
    list(filters) { throw new Error('Not implemented'); }
    /**
     * @param {number} id
     */
    getConfigs(id) { throw new Error('Not implemented'); }
    /**
     * @param {number} id
     */
    validateStatus(id) { throw new Error('Not implemented'); }
    /**
     * @param {string} date
     * @param {number} id
     */
    getNumberReleasesForMonth(date, id) { throw new Error('Not implemented'); }

    /**
     * @param {object} data
     */
    create(data) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {object} data
     */
    update(id, data) { throw new Error('Not implemented'); }
}
module.exports = { MgppInventoryRepositoryPorts }