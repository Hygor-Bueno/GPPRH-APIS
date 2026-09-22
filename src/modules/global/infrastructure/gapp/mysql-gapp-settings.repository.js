const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const {
    sqlInsertActiveClass, sqlInsertActiveType, sqlInsertCompany,
    sqlInsertUnit, sqlInsertDepartament, sqlInsertSubdepartament,
    buildInsertActiveClass, buildInsertActiveType, buildInsertCompany,
    buildInsertUnit, buildInsertDepartament, buildInsertSubdepartment,

    sqlUpdateActiveClass, sqlUpdateActiveType, sqlUpdateCompany,
    sqlUpdateUnit, sqlUpdateDepartament, sqlUpdateSubdepartament,
    buildUpdateActiveClass, buildUpdateActiveType, buildUpdateCompany,
    buildUpdateUnit, buildUpdateDepartament, buildUpdateSubdepartment
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

    // * INSERTS
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

    // * UPDATES
    async updateActiveType(payload, id) {
        const [result] = await this._query(sqlUpdateActiveType(), buildUpdateActiveType(payload, id));
        return { updated: result.affectedRows };
    }

    async updateActiveClass(payload, id) {
        const [result] = await this._query(sqlUpdateActiveClass(), buildUpdateActiveClass(payload, id));
        return { updated: result.affectedRows };
    }

    async updateCompany(payload, id) {
        const [result] = await this._query(sqlUpdateCompany(), buildUpdateCompany(payload, id));
        return { updated: result.affectedRows };
    }

    async updateUnit(payload, id) {
        const [result] = await this._query(sqlUpdateUnit(), buildUpdateUnit(payload, id));
        return { updated: result.affectedRows };
    }

    async updateDepartament(payload, id) {
        const [result] = await this._query(sqlUpdateDepartament(), buildUpdateDepartament(payload, id));
        return { updated: result.affectedRows };
    }

    async updateSubdeparment(payload, id) {
        const [result] = await this._query(sqlUpdateSubdepartament(), buildUpdateSubdepartment(payload, id));
        return { updated: result.affectedRows };
    }

}

module.exports = { MysqlSettingRepository }