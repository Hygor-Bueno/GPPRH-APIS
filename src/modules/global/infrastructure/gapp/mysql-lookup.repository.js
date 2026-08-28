/**
 * @fileoverview Adapter MySQL — implementa `LookupRepositoryPort`.
 *
 * @module modules/global/infrastructure/gapp/mysql-lookup.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { LookupRepositoryPort } = require('../../application/gapp/lookup/ports/lookup-repository.port');
const {
    sqlListUnits, sqlListActiveClass, sqlListWorkGroup,
    sqlListDriver, sqlListFuelType, sqlListUser,
    sqlListInsuranceCompany, sqlListTypeCoverage, sqlListUtilization,
    sqlListDepartments, sqlListDamageType, sqlListInfractions,
} = require('../../repositories/mysql/gapp-lookup.queries');

class MysqlLookupRepository extends LookupRepositoryPort {
    /** @private */
    async _query(sql) {
        try {
            const [rows] = await poolGlobal.query(sql);
            return rows;
        } catch (error) {
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_LOOKUP_MYSQL_ERROR',
                details: error
            });
        }
    }

    listUnits() { return this._query(sqlListUnits()); }
    listActiveClass() { return this._query(sqlListActiveClass()); }
    listWorkGroup() { return this._query(sqlListWorkGroup()); }
    listDriver() { return this._query(sqlListDriver()); }
    listFuelType() { return this._query(sqlListFuelType()); }
    listUser() { return this._query(sqlListUser()); }
    listInsuranceCompany() { return this._query(sqlListInsuranceCompany()); }
    listTypeCoverage() { return this._query(sqlListTypeCoverage()); }
    listUtilization() { return this._query(sqlListUtilization()); }
    listDepartments() { return this._query(sqlListDepartments()); }
    listDamageType() { return this._query(sqlListDamageType()); }
    listInfractions() { return this._query(sqlListInfractions()); }
}

module.exports = { MysqlLookupRepository };
