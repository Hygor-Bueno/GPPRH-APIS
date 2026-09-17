const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const {
    sqlListMovimentation,
    sqlListMovimentationById,
    sqlInsertMovimentation,
    sqlUpdateMovimentation,
    sqlActiveValuesById,
    buildInsertMovimentation,
    buildUpdateMovimentation
} = require('../../repositories/mysql/gapp-movimentation.queries');
const { sqlSaveActive, buildSaveActiveParams } = require('../../repositories/mysql/gapp-active.queries');

class MysqlMovimentationRepository {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_EXPENSES_MYSQL_ERROR',
                details: error
            });
        }
    }

    async listMovimentation() {
        const sql = sqlListMovimentation();
        const [rows] = await this._query(sql);

        return rows
    }

    async listMovimentationById(id) {
        const sql = sqlListMovimentationById();
        const [rows] = await this._query(sql, id);

        return rows
    }

    async findValueActive(id) {
        const sql = sqlActiveValuesById(id);
        const [rows] = await this._query(sql, id);

        return rows[0].value_purchase;
    }


    async insertMovimentation(payload, activeData) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.execute(sqlInsertMovimentation(), buildInsertMovimentation(payload));
            this._query(sqlSaveActive(), buildSaveActiveParams(activeData));

            await conn.commit();
            return { mov_id: result.insertId };
        } catch (err) {
            try { await conn.rollback(); } catch { }
            if (err instanceof AppError) throw err;
            throw new AppError(err.message, 500);
        } finally {
            conn.release();
        }
    }
    async updateMovimentation(id, payload, activeData) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.execute(sqlUpdateMovimentation(), buildUpdateMovimentation(payload, id));
            this._query(sqlSaveActive(), buildSaveActiveParams(activeData));

            await conn.commit();
            return { mov_id: id };
        } catch (err) {
            try { await conn.rollback(); } catch { }
            if (err instanceof AppError) throw err;
            throw new AppError(err.message, 500);
        } finally {
            conn.release();
        }
    }
}

module.exports = { MysqlMovimentationRepository }