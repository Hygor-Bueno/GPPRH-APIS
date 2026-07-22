const { poolGlobal } = require('../../../config/mysql');
const {
  sqlListUnits, sqlListActiveClass, sqlListWorkGroup,
  sqlListDriver, sqlListFuelType, sqlListUser,
  sqlListInsuranceCompany, sqlListTypeCoverage, sqlListUtilization,
  sqlListDepartments, sqlListDamageType, sqlListInfractions
} = require('../repositories/mysql/gapp-lookup.repository');
const { AppError } = require('../../../errors/app.error');

async function runList(sql) {
  let conn;
  try {
    conn = await poolGlobal.getConnection();
    const [rows] = await conn.query(sql);
    return rows;
  } catch (error) {
    throw new AppError(error.message, 500);
  } finally {
    if (conn) conn.release();
  }
}

class GappLookupService {
  listUnits()       { return runList(sqlListUnits()); }
  listActiveClass() { return runList(sqlListActiveClass()); }
  listWorkGroup()   { return runList(sqlListWorkGroup()); }
  listDriver()      { return runList(sqlListDriver()); }
  listFuelType()    { return runList(sqlListFuelType()); }
  listUser()        { return runList(sqlListUser()); }

  listInsuranceCompany() { return runList(sqlListInsuranceCompany()); }
  listTypeCoverage()     { return runList(sqlListTypeCoverage()); }
  listUtilization()      { return runList(sqlListUtilization()); }

  listDepartments() { return runList(sqlListDepartments()); }

  listDamageType() { return runList(sqlListDamageType()); }
  listInfractions() { return runList(sqlListInfractions()); }
}

module.exports = { GappLookupService };
