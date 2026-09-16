const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const {
    sqlListInfraction,
    sqlListInfractionById,
    sqlCreateInfraction,
    sqlUpdateInfraction,
    buildCreateInfraction,
    buildUpdateInfraction,
} = require('../../repositories/mysql/gapp-infraction.queries');

class MysqlInfractionRepository {

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

    async listInfraction() {
        const sql = sqlListInfraction();
        console.log(sql);
        const [rows] = await this._query(sql, []);
        return rows
    }

    async listInfractionById(id) {
        const [rows] = await this._query(sqlListInfractionById(), id);
        return rows
    }

    async insertInfraction(payload) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.execute(sqlCreateInfraction(), buildCreateInfraction(payload));
            const id = result.insertId;

            await conn.commit();

            return { infraction_id: id };
        } catch (err) {
            try { await conn.rollback(); } catch { }
            if (err instanceof AppError) throw err;
            throw new AppError(err.message, 500);
        } finally {
            conn.release();
        }
    }

    async updateInfraction(id, payload) {
        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();
            const [result] = await conn.execute(sqlUpdateInfraction(), buildUpdateInfraction(payload));

            await conn.commit();

            return { infraction_id: id };
        } catch (err) {
            try { await conn.rollback(); } catch { }
            if (err instanceof AppError) throw err;
            throw new AppError(err.message, 500);
        } finally {
            conn.release();
        }
    }
}

module.exports = { MysqlInfractionRepository }