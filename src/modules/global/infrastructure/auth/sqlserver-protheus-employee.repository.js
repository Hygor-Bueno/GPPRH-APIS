/**
 * @fileoverview Adapter SQL Server (Protheus) — implementa `ProtheusEmployeeRepositoryPort`.
 * @module modules/global/infrastructure/auth/sqlserver-protheus-employee.repository
 */

const { poolPromise, sql } = require('../../../../config/protheus');
const { AppError } = require('../../../../errors/app.error');
const { ProtheusEmployeeRepositoryPort } = require('../../application/auth/ports/protheus-employee-repository.port');
const { sqlEmployeeData, sqlMapUserWithOrganization } = require('../../../protheus/repositories/cost-center.queries');

class SqlServerProtheusEmployeeRepository extends ProtheusEmployeeRepositoryPort {
    async findEmployeeDataByName(name) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('name', sql.NVarChar(200), name)
                .query(sqlEmployeeData());

            console.log(`[AD] getProtheusEmployeeData name="${name}" total=${result.recordset?.length}`, JSON.stringify(result.recordset));

            if (!result.recordset || result.recordset.length === 0) {
                throw new AppError(`Colaborador "${name}" não encontrado no Protheus`, 404);
            }
            if (result.recordset.length > 1) {
                throw new AppError(`Múltiplos colaboradores encontrados no Protheus para o nome "${name}". Entre em contato com o suporte.`, 409);
            }
            return result.recordset;
        } catch (err) {
            console.error('Erro ao buscar dados do funcionário:', err);
            throw err;
        }
    }

    async findUserOrganization(registration) {
        const pool = await poolPromise;
        const { sql: query, params } = sqlMapUserWithOrganization(registration);
        const request = pool.request();
        for (const [key, value] of Object.entries(params)) {
            request.input(key, value);
        }
        const result = await request.query(query);
        return result.recordset[0] ?? {};
    }
}

module.exports = { SqlServerProtheusEmployeeRepository };
