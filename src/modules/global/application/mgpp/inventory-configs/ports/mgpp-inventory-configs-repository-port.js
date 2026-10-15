class MgppInventoryConfigsRepositoryPorts {
    /**
    * @param {number} accessCode - `_user.id` do usuário autenticado.
    */
    list(filters) { throw new Error('Not implemented'); }

    listPendings() { throw new Error('Not implemented'); }

    /**
     * @param {object} data
     */
    create(data) { throw new Error('Not implemented'); }

    /**
     *  @param {number, object} id, data 
     */
    update(id, data) { throw new Error('Not implemented'); }
}
module.exports = { MgppInventoryConfigsRepositoryPorts }