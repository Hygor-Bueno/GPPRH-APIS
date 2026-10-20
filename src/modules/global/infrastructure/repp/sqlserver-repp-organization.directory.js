/**
 * @fileoverview Adapter SQL Server (Protheus) — implementa
 * `OrganizationDirectoryPort` para a REPP.
 *
 * Pool `config/protheus` (usuário do Protheus, só TMPPRD12) — basta para
 * `SYS_COMPANY` e `CTTxx0`.
 *
 * @module modules/global/infrastructure/repp/sqlserver-repp-organization.directory
 */

const { poolPromise } = require('../../../../config/protheus');
const { AppError } = require('../../../../errors/app.error');
const { ReppErrorCode } = require('../../domain/repp/repp.enums');
const { OrganizationDirectoryPort } = require('../../application/repp/booking/ports/organization-directory.port');
const { SQL_FIND_COMPANY, SQL_FIND_BRANCH, sqlFindCostCenter } = require('../../repositories/sqlserver/repp-organization.queries');

/** "Invalid object name": empresa sem tabela de centro de custo nesta base. */
const SQLSERVER_INVALID_OBJECT = 208;

class SqlServerReppOrganizationDirectory extends OrganizationDirectoryPort {
    async resolve({ company_code, branch_code, cost_center_code }) {
        try {
            const pool = await poolPromise;

            const company = (await pool.request()
                .input('company_code', company_code)
                .query(SQL_FIND_COMPANY)).recordset[0] || null;
            if (!company) return { company: null, branch: null, costCenter: null };

            const branch = (await pool.request()
                .input('company_code', company_code)
                .input('branch_code', branch_code)
                .query(SQL_FIND_BRANCH)).recordset[0] || null;

            let costCenter = null;
            try {
                costCenter = (await pool.request()
                    .input('cost_center_code', cost_center_code)
                    .query(sqlFindCostCenter(company_code))).recordset[0] || null;
            } catch (error) {
                if (error?.number !== SQLSERVER_INVALID_OBJECT) throw error;
            }

            return { company, branch, costCenter };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('Não foi possível validar empresa, filial e centro de custo no Protheus. Tente novamente.', 500, {
                code: ReppErrorCode.ProtheusError,
                details: error,
            });
        }
    }
}

module.exports = { SqlServerReppOrganizationDirectory };
