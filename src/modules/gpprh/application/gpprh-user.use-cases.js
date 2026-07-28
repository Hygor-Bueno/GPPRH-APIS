/**
 * @fileoverview Consulta de usuários do gpprh.
 * @module modules/gpprh/application/gpprh-user.use-cases
 */
class GpprhUserUseCases {
    /**
     * @param {{ repository: import('./ports/gpprh-repository.port').GpprhRepositoryPort }} deps
     */
    constructor({ repository }) {
        this.repository = repository;
    }

    async listUsers() {
        return this.repository.getUser('');
    }
}

module.exports = { GpprhUserUseCases };
