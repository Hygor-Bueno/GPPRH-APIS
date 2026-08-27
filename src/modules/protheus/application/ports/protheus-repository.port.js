/**
 * @fileoverview Porta (contrato) de persistência SQL Server — Protheus.
 * @module modules/protheus/application/ports/protheus-repository.port
 */

class ProtheusRepositoryPort {
    /**
     * @param {string} companyCode
     * @returns {Promise<object[]>}
     * @throws {Error} nome `NoDataError` se não houver centros de custo para a empresa
     */
    findCostCenters(companyCode) { throw new Error('Not implemented'); }

    /** @param {string} companyCode @returns {Promise<object[]>} */
    findBranches(companyCode) { throw new Error('Not implemented'); }

    findAllBranches() { throw new Error('Not implemented'); }

    findCompanies() { throw new Error('Not implemented'); }
}

module.exports = { ProtheusRepositoryPort };
