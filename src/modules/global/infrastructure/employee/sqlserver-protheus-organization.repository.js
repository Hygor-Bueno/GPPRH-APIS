/**
 * @fileoverview Adapter SQL Server (Protheus) — implementa `ProtheusOrganizationRepositoryPort`.
 * @module modules/global/infrastructure/employee/sqlserver-protheus-organization.repository
 */

const { poolPromise } = require('../../../../config/protheus');
const { AppError } = require('../../../../errors/app.error');
const { ProtheusOrganizationRepositoryPort } = require('../../application/employee/ports/protheus-organization-repository.port');
const { sqlGetUserOrganizationBatch } = require('../../../protheus/repositories/cost-center.repository');

class SqlServerProtheusOrganizationRepository extends ProtheusOrganizationRepositoryPort {
    async findOrganizationBatch(pairs) {
        try {
            const pool = await poolPromise;
            const request = pool.request();

            pairs.forEach(({ registration, branch_code }, i) => {
                request.input(`r${i}`, registration);
                request.input(`f${i}`, branch_code);
            });

            const { recordset } = await request.query(sqlGetUserOrganizationBatch(pairs.length));
            return recordset;
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o Protheus.', 500, {
                code: 'EMPLOYEE_PROTHEUS_ERROR',
                details: error,
            });
        }
    }
}

module.exports = { SqlServerProtheusOrganizationRepository };
