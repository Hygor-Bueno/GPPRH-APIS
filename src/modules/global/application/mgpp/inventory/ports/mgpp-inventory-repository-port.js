class MgppInventoryRepositoryPorts {
    /**
    * @param {number} accessCode - `_user.id` do usuário autenticado.
    */
    list() { throw new Error('Not implemented'); }

    getConfigs(id) { throw new Error('Not implemented'); }
    
    getNumberReleasesForMonth(date, id) { throw new Error('Not implemented'); }

    /**
     * @param {object} data
     */
    create(data) { throw new Error('Not implemented'); }

    /**
     *  @param {number, object} id, data 
     */
    update(id, data) { throw new Error('Not implemented'); }
}
module.exports = { MgppInventoryRepositoryPorts }