/**
 * @fileoverview Casos de uso — Tabelas de apoio (lookup) GAPP.
 *
 * Delegação fina, sem guards nem regra de negócio — são só listas de
 * referência/dropdown.
 *
 * @module modules/global/application/gapp/lookup/gapp-lookup.use-cases
 */

class GappLookupUseCases {
    /** @param {{repository: import('./ports/lookup-repository.port').LookupRepositoryPort}} deps */
    constructor({ repository }) {
        this.repository = repository;
    }

    listUnits() { return this.repository.listUnits(); }
    listActiveClass() { return this.repository.listActiveClass(); }
    listWorkGroup() { return this.repository.listWorkGroup(); }
    listDriver() { return this.repository.listDriver(); }
    listFuelType() { return this.repository.listFuelType(); }
    listUser() { return this.repository.listUser(); }
    listInsuranceCompany() { return this.repository.listInsuranceCompany(); }
    listTypeCoverage() { return this.repository.listTypeCoverage(); }
    listUtilization() { return this.repository.listUtilization(); }
    listDepartments() { return this.repository.listDepartments(); }
    listSubDepartments() { return this.repository.listSubDepartments(); }
    listDamageType() { return this.repository.listDamageType(); }
    listInfractions() { return this.repository.listInfractions(); }
}

module.exports = { GappLookupUseCases };
