const { respond } = require("../../../utils/respond");
const { MaintenanceProcessUseCases } = require("../application/gapp/maintenance-process/maintenance-process.use-case")
const { MysqlGappUserRepository } = require("../infrastructure/gapp/mysql-gapp-user.repository")
const { MysqlMaintenanceProcessReposiroty } = require("../infrastructure/gapp/mysql-maintenance-process.repository")

const useCases = new MaintenanceProcessUseCases({
    repository: new MysqlMaintenanceProcessReposiroty(),
    userRepository: new MysqlGappUserRepository(),
})

async function listMaintenanceProcess(req, res) {
    const result = await useCases.repository.listMaintenanceProcess();
    return respond.ok(res, result);
}
async function listMaintenanceProcessById(req, res) {
    const result = await useCases.repository.listMaintenanceProcessById(Number(req.params.id), req.user);
    return respond.ok(res, result);
}

async function createMaitenanceProcess(req, res) {
    const result = await useCases.repository.createMaitenanceProcess(req.body, req.user);
    return respond.ok(res, result);
}

async function createMaitenanceProcessLogs(req, res) {
    const result = await useCases.repository.createMaitenanceProcessLogs(req.body, req.user);
    return respond.ok(res, result);
}

async function updateMaitenanceProcess(req, res) {
    const result = await useCases.repository.updateMaitenanceProcess(req.body, Number(req.params.id), req.user);
    return respond.ok(res, result);
}

async function updateMaitenanceProcessLogs(req, res) {
    const result = await useCases.repository.updateMaitenanceProcessLogs(req.body, Number(req.params.id), req.user);
    return respond.ok(res, result);
}

module.exports = {
    listMaintenanceProcess,
    listMaintenanceProcessById,
    createMaitenanceProcess,
    createMaitenanceProcessLogs,
    updateMaitenanceProcess,
    updateMaitenanceProcessLogs
}