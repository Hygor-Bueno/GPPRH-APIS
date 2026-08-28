/**
 * @fileoverview Porta (contrato) de persistência MySQL para veículos GAPP.
 *
 * Somente leitura — criação/atualização de veículo acontece via Active.
 *
 * @module modules/global/application/gapp/vehicle/ports/vehicle-repository.port
 */

class VehicleRepositoryPort {
    /** @param {object} filters */
    list(filters) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {number} workGroupFk
     * @returns {Promise<object|null>}
     */
    findById(id, workGroupFk) { throw new Error('Not implemented'); }
}

module.exports = { VehicleRepositoryPort };
