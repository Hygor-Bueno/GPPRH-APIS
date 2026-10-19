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
     *   name: ?string, full_name: ?string, cpf: string, birth_date: string, cost_center: ?string }[]>}
     */
    findByMonth(month, branchCodes) { throw new Error('Not implemented'); }

    /**
     * CPF do contrato (qualquer empresa).
     *
     * @param {string} branchCode - '0202'.
     * @param {string} registration - '002351'.
     * @returns {Promise<?string>} `null` se não houver contrato.
     */
    findEmployeeCpf(branchCode, registration) { throw new Error('Not implemented'); }

    /**
     * Contrato atual de cada CPF (vigente; sem vigente, a admissão mais recente).
     * CPF sem contrato não vem.
     *
     * @param {string[]} cpfs
     * @returns {Promise<{ cpf: string, branch_code: string, branch_name: ?string, registration: string,
     *   full_name: ?string, cost_center: ?string, dismissed: number }[]>}
     */
    findCurrentContractsByCpf(cpfs) { throw new Error('Not implemented'); }

    /**
     * Empresas do Protheus. A empresa é o prefixo da filial (`0202` → `02`).
     *
     * @returns {Promise<{ code: string, name: string }[]>}
     */
    findCompanies() { throw new Error('Not implemented'); }
}

module.exports = { BirthdayRepositoryPort };
