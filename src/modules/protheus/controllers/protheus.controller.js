const ProtheusService = require('../services/protheus.service');

async function listCostCenters(req, res) {
  const companyCode = req.params.code;
  const data = await ProtheusService.getCostCenters(companyCode);
  res.status(200).json({ error: false, data });
}

async function listBranches(req, res) {
  const companyCode = req.params.code;
  const data = await ProtheusService.getBranches(companyCode);
  res.status(200).json({ error: false, data });
}

async function listCompanies(req, res) {
  const data = await ProtheusService.getCompanies();
  res.status(200).json({ error: false, data });
}

module.exports = {
  listCostCenters,
  listBranches,
  listCompanies
};
