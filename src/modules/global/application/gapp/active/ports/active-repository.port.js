/**
 * @fileoverview Porta (contrato) de persistência MySQL para ativos GAPP.
 *
 * @module modules/global/application/gapp/active/ports/active-repository.port
 */

class ActiveRepositoryPort {
    /**
     * @param {number} activeId
     * @param {number} workGroupFk
     * @returns {Promise<{is_vehicle: number}|null>}
     */
    findIsVehicleByActiveId(activeId, workGroupFk) { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<{id: number, insurance_id: number|null}>} */
    saveActive(payload) { throw new Error('Not implemented'); }

    /** @param {object} filters */
    list(filters) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {number} workGroupFk
     * @returns {Promise<object|null>}
     */
    findById(id, workGroupFk) { throw new Error('Not implemented'); }

    /** @param {number} activeId */
    findVehicleByActiveId(activeId) { throw new Error('Not implemented'); }
}

module.exports = { ActiveRepositoryPort };
