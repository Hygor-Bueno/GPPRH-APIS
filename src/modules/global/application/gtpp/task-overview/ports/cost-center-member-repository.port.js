/**
 * @fileoverview Porta (contrato) — colaboradores de um centro de custo no
 * Protheus, para a sub-feature Task Overview (GTPP).
 * @module modules/global/application/gtpp/task-overview/ports/cost-center-member-repository.port
 */

class CostCenterMemberRepositoryPort {
    /**
     * @param {{companyCode: string, costCenterCode: string, branchCode: ?string}} criteria
     * @returns {Promise<Array<{registration: string, branchCode: string}>>} vazio se ninguém pertence ao CC
     */
    findMembers(criteria) { throw new Error('Not implemented'); }
}

module.exports = { CostCenterMemberRepositoryPort };
