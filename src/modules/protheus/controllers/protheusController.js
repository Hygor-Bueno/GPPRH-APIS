const e = require('express');
const ProtheusService = require('../services/protheusService');

async function listCostCenters(req, res) {
  try {
    const companyCode = req.params.code;
    const data = await ProtheusService.getCostCenters(companyCode);
    res.status(200).json({ error: false, data });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message, name: err.name });
  }
}

async function listBranches(req, res) {
  try {
    const companyCode = req.params.code;
    const data = await ProtheusService.getBranches(companyCode);
    res.status(200).json({ error: false, data });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
}

async function listCompanies(req, res) {
  try {
    const data = await ProtheusService.getCompanies();
    res.status(200).json({ error: false, data });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
}

module.exports = {
  listCostCenters,
  listBranches,
  listCompanies
};
