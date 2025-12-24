const ProtheusService = require('../services/protheusService');

async function listCostCenters(req, res) {
  try {
    const data = await ProtheusService.getCostCenters();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: true, message: 'Erro ao buscar centros de custo' });
  }
}

async function listBranches(req, res) {
  try {
    const data = await ProtheusService.getBranches();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: true, message: 'Erro ao buscar filiais' });
  }
}

async function getBranch(req, res) {
  try {
    const { code } = req.params;
    const data = await ProtheusService.getBranchByCode(code);
    if (!data) return res.status(404).json({ error: true, message: 'Filial não encontrada' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: true, message: 'Erro ao buscar filial' });
  }
}

module.exports = {
  listCostCenters,
  listBranches,
  getBranch
};
