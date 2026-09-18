/**
 * @fileoverview Porta (contrato) de persistência MySQL para tabelas de apoio
 * (lookup) do GAPP. Somente leitura, sem parâmetros, sem paginação.
 *
 * @module modules/global/application/gapp/lookup/ports/lookup-repository.port
 */

class LookupRepositoryPort {
    listUnits() { throw new Error('Not implemented'); }
    listActiveClass() { throw new Error('Not implemented'); }
    listWorkGroup() { throw new Error('Not implemented'); }
    listDriver() { throw new Error('Not implemented'); }
    listFuelType() { throw new Error('Not implemented'); }
    listUser() { throw new Error('Not implemented'); }
    listInsuranceCompany() { throw new Error('Not implemented'); }
    listTypeCoverage() { throw new Error('Not implemented'); }
    listUtilization() { throw new Error('Not implemented'); }
    listDepartments() { throw new Error('Not implemented'); }
    listSubDepartments() { throw new Error('Not implemented'); }
    listDamageType() { throw new Error('Not implemented'); }
    listInfractions() { throw new Error('Not implemented'); }
}

module.exports = { LookupRepositoryPort };
