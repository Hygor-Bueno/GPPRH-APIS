/**
 * @fileoverview Adapter Protheus — implementa `GtppScopeNameResolverPort`.
 *
 * Saiu de `gtpp-task-scope.controller` para o dossiê usar a mesma tradução
 * de códigos sem duplicá-la. Uma consulta de empresas e, por empresa
 * distinta, filiais e centros de custo em paralelo; falha do Protheus vira
 * nome null, nunca erro.
 *
 * @module modules/global/infrastructure/gtpp/protheus-gtpp-scope-name.resolver
 */

const { GtppScopeNameResolverPort } = require('../../application/gtpp/ports/gtpp-scope-name-resolver.port');

class ProtheusGtppScopeNameResolver extends GtppScopeNameResolverPort {
    /** @param {{protheusUseCases: import('../../../protheus/application/protheus.use-cases').ProtheusUseCases}} deps */
    constructor({ protheusUseCases }) {
        super();
        this.protheusUseCases = protheusUseCases;
    }

    async resolve(scopeRows) {
        if (scopeRows.length === 0) return [];

        const companyCodes = [...new Set(scopeRows.map(s => s.company_code).filter(Boolean))];

        const [companies, ...branchesAndCCs] = await Promise.all([
            this.protheusUseCases.getCompanies().catch(() => []),
            ...companyCodes.map(code =>
                Promise.all([
                    this.protheusUseCases.getBranches(code).catch(() => []),
                    this.protheusUseCases.getCostCenters(code).catch(() => []),
                ])
            ),
        ]);

        const companyMap    = Object.fromEntries(companies.map(c => [c.company_code, c.company_name]));
        const branchMap     = {};
        const costCenterMap = {};

        branchesAndCCs.forEach(([branches, ccs]) => {
            branches.forEach(b => { branchMap[b.branch_code]         = b.branch_name; });
            ccs.forEach(cc     => { costCenterMap[cc.costCenterCode] = cc.costCenterDescription; });
        });

        return scopeRows.map(s => ({
            ...s,
            company_name:     s.company_code     ? (companyMap[s.company_code]          ?? null) : null,
            branch_name:      s.branch_code      ? (branchMap[s.branch_code]            ?? null) : null,
            cost_center_name: s.cost_center_code ? (costCenterMap[s.cost_center_code]   ?? null) : null,
        }));
    }
}

module.exports = { ProtheusGtppScopeNameResolver };
