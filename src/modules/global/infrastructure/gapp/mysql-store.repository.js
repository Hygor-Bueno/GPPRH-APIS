/**
 * @fileoverview Adapter MySQL — implementa `StoreRepositoryPort`.
 *
 * @module modules/global/infrastructure/gapp/mysql-store.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { StoreRepositoryPort } = require('../../application/gapp/store/ports/store-repository.port');
const {
    sqlListStores, sqlCountStores, sqlGetStoreById,
    sqlCheckStoreExists,
    sqlInsertStore, buildInsertStoreParams,
    sqlUpdateStore, buildUpdateStoreParams,
    sqlSoftDeleteStore,
} = require('../../repositories/mysql/gapp-store.queries');

class MysqlStoreRepository extends StoreRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_STORE_MYSQL_ERROR',
                details: error
            });
        }
    }

    async list(filters) {
        const { sql, params } = sqlListStores(filters);
        const { sql: countSql, params: countParams } = sqlCountStores(filters);
        const [rows] = await this._query(sql, params);
        const [[{ total }]] = await this._query(countSql, countParams);
        return { items: rows, total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 20 };
    }

    async findById(id) {
        const [rows] = await this._query(sqlGetStoreById(), [id]);
        return rows[0] ?? null;
    }

    async storeExists(id) {
        const [rows] = await this._query(sqlCheckStoreExists(), [id]);
        return Boolean(rows[0]);
    }

    async insert(fields) {
        const [result] = await this._query(sqlInsertStore(), buildInsertStoreParams(fields));
        return { insertId: result.insertId };
    }

    async update(id, fields) {
        const [result] = await this._query(sqlUpdateStore(), buildUpdateStoreParams(fields, id));
        return { updated: result.affectedRows };
    }

    async softDeleteStore(id) {
        await this._query(sqlSoftDeleteStore(), [id]);
    }
}

module.exports = { MysqlStoreRepository };
