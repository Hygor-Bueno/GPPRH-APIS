/**
 * @fileoverview Porta (contrato) de persistência MySQL para seguro GAPP.
 *
 * Compartilhada: consumida nativamente pela feature Insurance, e por Active/
 * Vehicle (`getById`) só para `findActiveInsuranceByVehicleId`.
 *
 * @module modules/global/application/gapp/ports/gapp-insurance-repository.port
 */

class GappInsuranceRepositoryPort {
    /** @param {object} payload @returns {Promise<{id: number}>} */
    saveInsurancePolicy(payload) { throw new Error('Not implemented'); }

    /** @param {object} filters */
    list(filters) { throw new Error('Not implemented'); }

    /** @param {number} id @param {number} workGroupFk */
    getById(id, workGroupFk) { throw new Error('Not implemented'); }

    /** @param {number} vehicleId @returns {Promise<{work_group_fk: number}|null>} */
    findVehicleWorkGroup(vehicleId) { throw new Error('Not implemented'); }

    /** @param {number} idInsurance @returns {Promise<{work_group_fk: number}|null>} */
    findInsuranceWorkGroup(idInsurance) { throw new Error('Not implemented'); }

    /** @param {number} vehicleId @returns {Promise<object|null>} Seguro ativo do veículo. */
    findActiveInsuranceByVehicleId(vehicleId) { throw new Error('Not implemented'); }
}

module.exports = { GappInsuranceRepositoryPort };
