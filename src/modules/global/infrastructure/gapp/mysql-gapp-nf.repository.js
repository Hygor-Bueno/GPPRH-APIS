const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const {
    sqlListNF,
    sqlListNFById,
    sqlListCuponsAssociated,
    sqlListCouponsDisassociated,
    sqlInsertNF,
    sqlUpdateNF,
    sqlDeleteNFById,
    sqlCountNFRegistered,
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

    async updateNf(id, payload) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute(sqlUpdateNF(), buildUpdateNfParams({ ...payload, nf_id: id }));

            await conn.commit();
            return { nf_id: id };
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
        const [rows] = await this._query(sql, params);
        const [[{ total }]] = await this._query(sqlCountNFRegistered())

        return { items: rows, total: total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 20 };
    }

    // listById: vai retornar minha nf com todos os cupons registrados nela
    async listNFById(id) {
        const sql = sqlListNFById(id);
        const [rows] = await this._query(sql);
        const cupons = await this._resolveCupons(rows[0].nf_key)
        return { ...rows[0], coupons: cupons }
    }

    async _resolveCupons(nf_key) {
        const sql = sqlListCuponsAssociated(nf_key);
        const [rows] = await this._query(sql);
        return rows
    }

    // listCupons: vai listar todos os cupons que estão livres para serem vinculados a uma nota fiscal
    async listCoupon() {
        const sql = sqlListCouponsDisassociated();
        const [rows] = await this._query(sql);
        return rows
    }

    async deleteNF(nf_id) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute(sqlDeleteNFById(nf_id));

            await conn.commit();
            return { nf_id: nf_id };
        } catch (err) {
            try { await conn.rollback(); } catch { /* conexão já pode ter caído */ }
            if (err instanceof AppError) throw err;
            throw new AppError(err.message, 500);
        } finally {
            conn.release();
        }
    }
}

module.exports = { MysqlNfRepository }