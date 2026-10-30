const { AppError } = require('../../../../../errors/app.error');

class MaintenanceProcessUseCases {
    /**
    * @param {Object} deps
    * @param {import('./ports/maitenance-process.repository-ports').MaintenanceProcessRepositoryPorts} deps.repository
    * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
    */
    constructor({ repository, userRepository, insuranceRepository }) {
        this.repository = repository;
        this.userRepository = userRepository;
    }

    async listMaintenanceProcess() {
        return await this.repository.listMaintenanceProcess()
    }
    async listMaintenanceProcessById(id) {
        return await this.repository.listMaintenanceProcessById(id)
    }

    async createMaitenanceProcess(payload) {
        return await this.repository.createMaitenanceProcess(payload)
    }

    async createMaitenanceProcessLogs(payload) {
        return await this.repository.createMaitenanceProcessLogs(payload)
    }

    async updateMaitenanceProcess(payload, id) {
        return await this.repository.updateMaitenanceProcess(payload, id)
    }

    async updateMaitenanceProcessLogs(payload, id) {
        return await this.repository.updateMaitenanceProcessLogs(payload, id)
    }
}
module.exports = { MaintenanceProcessUseCases }