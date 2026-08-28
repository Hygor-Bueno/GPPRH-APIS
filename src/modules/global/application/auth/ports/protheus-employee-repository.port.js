/**
 * @fileoverview Porta (contrato) de dados de colaborador no Protheus — Auth.
 * @module modules/global/application/auth/ports/protheus-employee-repository.port
 */

class ProtheusEmployeeRepositoryPort {
    /**
     * Busca os dados do colaborador pelo nome (primeiro login via AD).
     * @param {string} name
     * @returns {Promise<object[]>}
     * @throws {AppError} 404 se não encontrar / 409 se encontrar mais de um
     */
    findEmployeeDataByName(name) { throw new Error('Not implemented'); }

    /**
     * Dados organizacionais (empresa/filial/centro de custo) por matrícula.
     * @param {string} registration
     * @returns {Promise<object>} objeto vazio se não encontrado
     */
    findUserOrganization(registration) { throw new Error('Not implemented'); }
}

module.exports = { ProtheusEmployeeRepositoryPort };
