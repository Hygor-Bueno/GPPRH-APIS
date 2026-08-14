/**
 * @fileoverview Adapter SQL Server — implementa `ProtheusRepositoryPort`.
 * @module modules/protheus/infrastructure/sqlserver-protheus.repository
 */

const { poolPromise } = require('../../../config/protheus');
const { ProtheusRepositoryPort } = require('../application/ports/protheus-repository.port');
const { sqlCostCenter, sqlBranch, sqlAllBranches, sqlCompany } = require('../repositories/cost-center.queries');

class SqlServerProtheusRepository extends ProtheusRepositoryPort {
    async findCostCenters(companyCode) {
        const pool = await poolPromise;
        const result = await pool.request().query(sqlCostCenter(companyCode));
        if (result.recordset.length === 0) {
            const err = new Error(`No data for company: ${companyCode}`);
            err.name = 'NoDataError';
            throw err;
        }
        return result.recordset;
    }

    async findBranches(companyCode) {
        const pool = await poolPromise;
        const { sql, params } = sqlBranch(companyCode);
        const request = pool.request();
        for (const [key, value] of Object.entries(params)) {
            request.input(key, value);
        }
        const result = await request.query(sql);
        return result.recordset;
    }

    async findAllBranches() {
        const pool = await poolPromise;
        const result = await pool.request().query(sqlAllBranches());
        return result.recordset;
    }

    async findCompanies() {
        const pool = await poolPromise;
        const result = await pool.request().query(sqlCompany());
        return result.recordset;
    }
}

module.exports = { SqlServerProtheusRepository };
