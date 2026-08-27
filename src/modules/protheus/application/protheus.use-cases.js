/**
 * @fileoverview Casos de uso — Protheus (empresas, filiais, centros de custo).
 * @module modules/protheus/application/protheus.use-cases
 */

class ProtheusUseCases {
    /** @param {{repository: import('./ports/protheus-repository.port').ProtheusRepositoryPort}} deps */
    constructor({ repository }) {
        this.repository = repository;
    }

    async getCostCenters(companyCode) {
        return this.repository.findCostCenters(companyCode);
    }

    async getBranches(companyCode) {
        return this.repository.findBranches(companyCode);
    }

    async getAllBranches() {
        return this.repository.findAllBranches();
    }

    async getCompanies() {
        return this.repository.findCompanies();
    }
}

module.exports = { ProtheusUseCases };
