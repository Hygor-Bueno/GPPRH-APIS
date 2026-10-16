/**
 * @fileoverview Adapter SQL Server — implementa `BirthdayRepositoryPort`.
 * @module modules/global/infrastructure/gipp-rh/sqlserver-birthday.repository
 */

const { poolPromise, sql } = require('../../../../config/sqlserver');
const { AppError } = require('../../../../errors/app.error');
const { BirthdayRepositoryPort } = require('../../application/gipp-rh/birthday/ports/birthday-repository.port');
const { sqlFindBirthdaysByMonth } = require('../../repositories/sqlserver/birthday.queries');

class SqlServerBirthdayRepository extends BirthdayRepositoryPort {
    async findByMonth(month, branchCodes) {
        try {
            const pool = await poolPromise;
            const request = pool.request()
                // RA_NASC é CHAR(8) 'YYYYMMDD' — o mês compara como texto com zero à esquerda.
                .input('month', sql.VarChar(2), String(month).padStart(2, '0'));
            branchCodes.forEach((code, i) => request.input(`branch${i}`, sql.VarChar(8), code));
            const result = await request.query(sqlFindBirthdaysByMonth(branchCodes.length));
            return result.recordset;
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao buscar aniversariantes', 500, {
                code: 'SQLSERVER_ERROR',
                details: error,
            });
        }
    }
}

module.exports = { SqlServerBirthdayRepository };
