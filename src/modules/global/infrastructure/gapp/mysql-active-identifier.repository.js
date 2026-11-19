/**
 * @fileoverview Adapter MySQL — implementa `ActiveIdentifierRepositoryPort`.
 *
 * `ER_DUP_ENTRY` (índice único de tipo + valor, quando existir) vira 409: é a
 * mesma regra do use-case, garantida também no banco contra cadastro simultâneo.
 *
 * @module modules/global/infrastructure/gapp/mysql-active-identifier.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { ActiveIdentifierRepositoryPort } = require('../../application/gapp/active-identifier/ports/active-identifier-repository.port');
const {
    sqlActiveInGroup, sqlListByActive, sqlGetById, sqlFindByValue, sqlInsert, sqlSetPrimary, sqlDelete,
} = require('../../repositories/mysql/gapp-active-identifier.queries');

function toAppError(error) {
    if (error instanceof AppError) return error;
    if (error?.code === 'ER_DUP_ENTRY') {
        return new AppError('Este identificador já está cadastrado em outro ativo.', 409, { code: 'GAPP_ACTIVE_IDENTIFIER_IN_USE' });
    }
    return new AppError(error?.message || 'Erro ao acessar o banco de dados.', 500, {
        code: 'GAPP_ACTIVE_IDENTIFIER_MYSQL_ERROR',
        details: error,
    });
}

class MysqlActiveIdentifierRepository extends ActiveIdentifierRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            throw toAppError(error);
        }
    }

    async activeInGroup(activeId, workGroupFk) {
        const [rows] = await this._query(sqlActiveInGroup(), [activeId, workGroupFk]);
        return Boolean(rows[0]);
    }

    async listByActive(activeId) {
        const [rows] = await this._query(sqlListByActive(), [activeId]);
        return rows;
    }

    async findById(identifierId, activeId) {
        const [rows] = await this._query(sqlGetById(), [identifierId, activeId]);
        return rows[0] ?? null;
    }

    async findByValue(type, value) {
        const [rows] = await this._query(sqlFindByValue(), [type, value]);
        return rows[0] ?? null;
    }

    async insert(activeId, type, value) {
        const [result] = await this._query(sqlInsert(), [activeId, type, value]);
        return { insertId: result.insertId };
    }

    async setPrimary(identifierId, activeId) {
        await this._query(sqlSetPrimary(), [identifierId, activeId]);
    }

    async delete(identifierId, activeId) {
        const [result] = await this._query(sqlDelete(), [identifierId, activeId]);
        return { deleted: result.affectedRows };
    }
}

module.exports = { MysqlActiveIdentifierRepository };
