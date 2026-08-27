/**
 * @fileoverview Porta (contrato) de enriquecimento organizacional via Protheus.
 * @module modules/global/application/employee/ports/protheus-organization-repository.port
 */

class ProtheusOrganizationRepositoryPort {
    /**
     * @param {Array<{registration:string, branch_code:string}>} pairs
     * @returns {Promise<object[]>}
     */
    findOrganizationBatch(pairs) { throw new Error('Not implemented'); }
}

module.exports = { ProtheusOrganizationRepositoryPort };
