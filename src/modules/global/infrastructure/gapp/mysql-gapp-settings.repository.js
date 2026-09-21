const { AppError } = require('../../../../errors/app.error');
const {
    sqlInsertActiveClass,
    sqlInsertActiveType,
    sqlInsertCompany,
    sqlInsertUnit,
    sqlInsertDepartament,
    sqlInsertSubdepartament,
    buildInsertActiveClass,
    buildInsertActiveType,
    buildInsertCompany,
    buildInsertUnit,
    buildInsertDepartament,
    buildInsertSubdepartment
} = require('../../repositories/mysql/gapp-settings.queries.js');

class MysqlSettingRepository {
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


    async insertActiveType(payload) {
        const [result] = await this._query(sqlInsertActiveType(), buildInsertActiveType(payload));
        return { insertId: result.insertId };
    }

    async insertActiveClass(payload) {
        const [result] = await this._query(sqlInsertActiveClass(), buildInsertActiveClass(payload));
        return { insertId: result.insertId };
    }

    async insertCompany(payload) {
        const [result] = await this._query(sqlInsertCompany(), buildInsertCompany(payload));
        return { insertId: result.insertId };
    }

    async insertUnit(payload) {
        const [result] = await this._query(sqlInsertUnit(), buildInsertUnit(payload));
        return { insertId: result.insertId };
    }

    async insertDepartament(payload) {
        const [result] = await this._query(sqlInsertDepartament(), buildInsertDepartament(payload));
        return { insertId: result.insertId };
    }

    async insertSubdeparment(payload) {
        const [result] = await this._query(sqlInsertSubdepartament(), buildInsertSubdepartment(payload));
        return { insertId: result.insertId };
    }

}

module.exports = { MysqlSettingRepository }