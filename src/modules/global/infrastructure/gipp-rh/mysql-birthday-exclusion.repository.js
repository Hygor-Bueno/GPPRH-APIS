/**
 * @fileoverview Adapter MySQL (`poolGlobal`) — implementa `BirthdayExclusionRepositoryPort`.
 *
 * Nenhuma mensagem crua do MySQL chega ao cliente: o `AppError` leva o erro
 * em `details` e o `error.middleware` decide o que sai.
 *
 * @module modules/global/infrastructure/gipp-rh/mysql-birthday-exclusion.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { BirthdayExclusionRepositoryPort } = require('../../application/gipp-rh/birthday/ports/birthday-exclusion-repository.port');
const { BirthdayErrorCode } = require('../../domain/gipp-rh/birthday.rules');
const {
    SQL_LIST_EXCLUDED_CPFS,
    SQL_LIST_EXCLUSIONS,
    SQL_INSERT_EXCLUSION,
    SQL_DELETE_EXCLUSION,
} = require('../../repositories/mysql/birthday-exclusion.queries');

async function query(sql, params, message) {
    try {
        const [result] = await poolGlobal.execute(sql, params);
        return result;
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            throw new AppError('Este colaborador já está fora do cartaz.', 409, {
                code: BirthdayErrorCode.AlreadyExcluded,
            });
        }
        throw new AppError(message, 500, { code: BirthdayErrorCode.MysqlError, details: error });
    }
}

class MySqlBirthdayExclusionRepository extends BirthdayExclusionRepositoryPort {
    async listCpfs() {
        const rows = await query(SQL_LIST_EXCLUDED_CPFS, [], 'Erro ao ler a lista de exclusão do cartaz.');
        return rows.map(row => row.cpf);
    }

    async list() {
        const rows = await query(SQL_LIST_EXCLUSIONS, [], 'Erro ao ler a lista de exclusão do cartaz.');
        return rows.map(row => ({ ...row, id: Number(row.id), created_by: Number(row.created_by) }));
    }

    async add({ cpf, reason, createdBy }) {
        const result = await query(SQL_INSERT_EXCLUSION, [cpf, reason, createdBy],
            'Erro ao tirar o colaborador do cartaz.');
        return Number(result.insertId);
    }

    async remove(id) {
        const result = await query(SQL_DELETE_EXCLUSION, [id], 'Erro ao devolver o colaborador ao cartaz.');
        return result.affectedRows > 0;
    }
}

module.exports = { MySqlBirthdayExclusionRepository };
