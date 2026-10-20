/**
 * @fileoverview Adapter SQL Server — implementa `BirthdayRepositoryPort`.
 * @module modules/global/infrastructure/gipp-rh/sqlserver-birthday.repository
 */

const { poolPromise, sql } = require('../../../../config/sqlserver');
const { AppError } = require('../../../../errors/app.error');
const { BirthdayRepositoryPort } = require('../../application/gipp-rh/birthday/ports/birthday-repository.port');
const {
    sqlFindBirthdaysByMonth,
    sqlFindEmployeeCpf,
    sqlFindCurrentContractsByCpf,
    sqlFindCompanies,
} = require('../../repositories/sqlserver/birthday.queries');

/** Folga sob o limite de 2100 parâmetros por request do SQL Server. */
const CPF_CHUNK = 1000;

function toAppError(error, message) {
    if (error instanceof AppError) return error;
    return new AppError(error.message || message, 500, {
        code: 'SQLSERVER_ERROR',
        details: error,
    });
}

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
            throw toAppError(error, 'Erro ao buscar aniversariantes');
        }
    }

    async findEmployeeCpf(branchCode, registration) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('branchCode', sql.VarChar(12), branchCode)
                .input('registration', sql.VarChar(6), registration)
                .query(sqlFindEmployeeCpf());
            return result.recordset[0]?.cpf || null;
        } catch (error) {
            throw toAppError(error, 'Erro ao buscar o colaborador');
        }
    }

    async findCurrentContractsByCpf(cpfs) {
        if (!cpfs.length) return [];
        try {
            const pool = await poolPromise;
            const rows = [];
            for (let start = 0; start < cpfs.length; start += CPF_CHUNK) {
                const chunk = cpfs.slice(start, start + CPF_CHUNK);
                const request = pool.request();
                chunk.forEach((cpf, i) => request.input(`cpf${i}`, sql.VarChar(11), cpf));
                const result = await request.query(sqlFindCurrentContractsByCpf(chunk.length));
                rows.push(...result.recordset);
            }
            return rows;
        } catch (error) {
            throw toAppError(error, 'Erro ao buscar os colaboradores fora do cartaz');
        }
    }

    async findCompanies() {
        try {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlFindCompanies());
            return result.recordset;
        } catch (error) {
            throw toAppError(error, 'Erro ao buscar as empresas');
        }
    }
}

module.exports = { SqlServerBirthdayRepository };
