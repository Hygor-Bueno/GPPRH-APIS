const { poolPromise } = require('../../../config/protheus');
const { sqlCostCenter, sqlBranch,sqlCompany } = require('../queries/costCenterRepository');

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
    const result = await pool.request().query(sqlBranch(companyCode));
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
  getCompanies
};
