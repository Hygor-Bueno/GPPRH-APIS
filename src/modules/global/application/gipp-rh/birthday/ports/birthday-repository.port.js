/**
 * @fileoverview Porta de leitura dos aniversariantes (Protheus).
 * @module modules/global/application/gipp-rh/birthday/ports/birthday-repository.port
 */

class BirthdayRepositoryPort {
    /**
     * Colaboradores ativos que fazem aniversário no mês.
     *
     * @param {number} month - 1 a 12.
     * @param {string[]} branchCodes - vazio = todas as filiais.
     * @returns {Promise<{ branch_code: string, branch_name: ?string, registration: string,
     *   name: ?string, full_name: ?string, birth_date: string, cost_center: ?string }[]>}
     */
    findByMonth(month, branchCodes) { throw new Error('Not implemented'); }
}

module.exports = { BirthdayRepositoryPort };
