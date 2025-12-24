const { poolPromise } = require('../../../config/protheus');
const { sqlCostCenter, sqlBranch, sqlBranchByCode } = require('../queries/costCenterRepository');

async function getCostCenters() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(sqlCostCenter());
    return result.recordset;
  } catch (err) {
    console.error('Erro ao buscar centros de custo:', err);
    throw err;
  }
}

async function getBranches() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(sqlBranch());
    return result.recordset;
  } catch (err) {
    console.error('Erro ao buscar filiais:', err);
    throw err;
  }
}

async function getBranchByCode(code) {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('code', code)
      .query(sqlBranchByCode());
    return result.recordset[0] || null;
  } catch (err) {
    console.error('Erro ao buscar filial por código:', err);
    throw err;
  }
}

module.exports = {
  getCostCenters,
  getBranches,
  getBranchByCode
};
