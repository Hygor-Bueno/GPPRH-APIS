const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { OperatorRepositoryPorts } = require('../../application/gapp/operator/ports/gapp-operator.ports');
const { SQL_LIST_OPERATOR, SQL_INSERT_OPERTATOR, SQL_UPDATE_OPERATOR } = require('../../repositories/mysql/gapp-operator.queries');

class MysqlOperatorRepository extends OperatorRepositoryPorts {
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

    async listOperators() {
        const [rows] = await this._query(SQL_LIST_OPERATOR);
        return rows;
    }

    async createOperator(name) {
        const [result] = await this._query(SQL_INSERT_OPERTATOR, name);
        return { insertId: result.insertId };
    }

    async updateOperator(name, id) {
        await this._query(SQL_UPDATE_OPERATOR, [name, id]);
        return { updated: id };
    }
}

module.exports = { MysqlOperatorRepository }