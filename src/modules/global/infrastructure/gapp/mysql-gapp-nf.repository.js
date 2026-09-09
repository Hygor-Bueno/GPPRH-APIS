const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const {
    sqlListNF,
    sqlInsertNF,
    sqlUpdateNF,
    buildInserNfParams,
    buildUpdateNfParams
} = require('../../repositories/mysql/gapp-nf-queries');

class MysqlNfRepository {
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

    async createNf(payload) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.execute(sqlInsertNF(), buildInserNfParams(payload));
            const nfId = result.insertId;

            await conn.commit();
            return { nf_id: nfId };
        } catch (err) {
            try { await conn.rollback(); } catch { /* conexão já pode ter caído */ }
            if (err instanceof AppError) throw err;
            throw new AppError(err.message, 500);
        } finally {
            conn.release();
        }
    }

    async updateNf(payload) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute(sqlUpdateNF(), buildUpdateNfParams(payload));


            await conn.commit();
            return { nf_id: payload.nf_id };
        } catch (err) {
            try { await conn.rollback(); } catch { /* conexão já pode ter caído */ }
            if (err instanceof AppError) throw err;
            throw new AppError(err.message, 500);
        } finally {
            conn.release();
        }
    }
    // Listar 
    async listNf(filters) {
        const { sql, params } = sqlListNF(filters);
        return this._query(sql, params);
    }
}

module.exports = { MysqlNfRepository }