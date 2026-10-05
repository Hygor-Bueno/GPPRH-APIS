/**
 * @fileoverview Adapter SQL Server (Protheus) — implementa `CostCenterMemberRepositoryPort`.
 * @module modules/global/infrastructure/gtpp/sqlserver-cost-center-member.repository
 */

const { poolPromise } = require('../../../../config/protheus');
const { AppError } = require('../../../../errors/app.error');
const { CostCenterMemberRepositoryPort } = require('../../application/gtpp/task-overview/ports/cost-center-member-repository.port');
const { sqlEmployeesByCostCenter } = require('../../../protheus/repositories/cost-center.queries');

class SqlServerCostCenterMemberRepository extends CostCenterMemberRepositoryPort {
    async findMembers({ companyCode, costCenterCode, branchCode = null }) {
        const sql = sqlEmployeesByCostCenter(companyCode, Boolean(branchCode));
        if (!sql) return [];

        try {
            const pool = await poolPromise;
            const request = pool.request();
            request.input('cost_center', costCenterCode);
            if (branchCode) request.input('branch_code', branchCode);

            const { recordset } = await request.query(sql);
            return recordset.map(r => ({ registration: r.registration, branchCode: r.branch_code }));
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o Protheus.', 500, {
                code: 'GTPP_TASK_OVERVIEW_PROTHEUS_ERROR',
                details: error,
            });
        }
    }
}

module.exports = { SqlServerCostCenterMemberRepository };
