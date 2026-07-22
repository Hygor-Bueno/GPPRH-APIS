const { poolPromise } = require('../../../config/protheus');
const { sqlCostCenter, sqlBranch, sqlAllBranches, sqlCompany } = require('../repositories/cost-center.repository');

async function getCostCenters(companyCode) {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(sqlCostCenter(companyCode));
    if (result.recordset.length === 0) {
      const err = new Error(`No data for company: ${companyCode}`);
      err.name = 'NoDataError'; // <- aqui você define o nome
      throw err;
    }
    return result.recordset;
  } catch (err) {
    throw err;
  }
}

async function getBranches(companyCode) {
  try {
    const pool = await poolPromise;
    const { sql, params } = sqlBranch(companyCode);
    const request = pool.request();
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
    const result = await request.query(sql);
    return result.recordset;
  } catch (err) {
    throw err;
  }
}

async function getAllBranches() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(sqlAllBranches());
    return result.recordset;
  } catch (err) {
    throw err;
  }
}

async function getCompanies() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(sqlCompany());
    return result.recordset;
  } catch (err) {
    throw err;
  }
}


module.exports = {
  getCostCenters,
  getBranches,
  getAllBranches,
  getCompanies
};
