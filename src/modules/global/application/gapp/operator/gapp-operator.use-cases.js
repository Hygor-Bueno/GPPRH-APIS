
const { AppError } = require('../../../../../errors/app.error');

class OperatorUseCases {

    /**
        * @param {Object} deps
        * @param {import('./ports/gapp-operator.ports').OperatorRepositoryPorts} deps.repository
        * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
        */
    constructor({ repository, userRepository, insuranceRepository }) {
        this.repository = repository;
        this.userRepository = userRepository;
    }

    async listOperators() {
        return await this.repository.listOperators()
    }

    async createOperator(name) {
        const { insertId } = await this.repository.createOperator(name);
        return { id_operator: insertId };
    }

    async updateOperator(name, id) {
        const { insertId } = await this.repository.updateOperator(name, id);
        return { id_operator: id };
    }

}

module.exports = { OperatorUseCases }