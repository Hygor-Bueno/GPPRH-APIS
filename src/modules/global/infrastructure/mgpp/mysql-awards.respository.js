const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { MgppAwardsRepositoryPorts } = require('../../../global/application/mgpp/ports/mgpp-awards-repository-ports')
const { sqlListAwards, sqlInsertAward, sqlUpdateAward,  } = require('../../repositories/mysql/mgpp-awards.queries');

class MgppAwardsRepository {

    /** @private */
    async _query(sql, params = []) {
        try {
            const req = await poolGlobal.query(sql, params);
            return req;
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_ACTIVE_MYSQL_ERROR',
                details: error
            });
        }
    }

    async list() {
        const [rows] = await this._query(sqlListAwards())
        return rows
    }

    async create(data) {
        let conn = await poolGlobal.getConnection();
        try {
            console.log("Aqui", sqlInsertAward(), [data.total_value_award, data.category_award])
            const [result] = await conn.execute(sqlInsertAward(), [data.total_value_award, data.category_award])
            return { insertId: result.insertId }
        } catch (error) {
            if (error instanceof AppError) throw error;
            const status = error.sqlState === '45000' ? 400 : 500;
            throw new AppError(error.sqlMessage || error.message, status);
        } finally {
            if (conn) conn.release();
        }
    }

    async update(id, data) {
        let conn = await poolGlobal.getConnection();
        try {
            const [result] = await conn.execute(sqlUpdateAward(), [data.total_value_award, data.category_award, id])
            return { id_updated: id }
        } catch (error) {
            if (error instanceof AppError) throw error;
            const status = error.sqlState === '45000' ? 400 : 500;
            throw new AppError(error.sqlMessage || error.message, status);
        } finally {
            if (conn) conn.release();
        }
    }
}

module.exports = { MgppAwardsRepository }