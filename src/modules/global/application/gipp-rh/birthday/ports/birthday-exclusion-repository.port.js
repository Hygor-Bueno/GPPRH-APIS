/**
 * @fileoverview Porta da lista de exclusão do cartaz de aniversariantes
 * (`rh_birthday_exclusions`, MySQL `global`).
 * @module modules/global/application/gipp-rh/birthday/ports/birthday-exclusion-repository.port
 */

class BirthdayExclusionRepositoryPort {
    /** @returns {Promise<string[]>} CPFs fora do cartaz. */
    listCpfs() { throw new Error('Not implemented'); }

    /**
     * @returns {Promise<{ id: number, cpf: string, reason: ?string,
     *   created_at: Date, created_by: number }[]>}
     */
    list() { throw new Error('Not implemented'); }

    /**
     * @param {{ cpf: string, reason: ?string, createdBy: number }} exclusion
     * @returns {Promise<number>} id criado.
     * @throws {AppError} 409 `GIPPRH_BIRTHDAY_ALREADY_EXCLUDED` se o CPF já está na lista.
     */
    add(exclusion) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @returns {Promise<boolean>} `false` se não existia.
     */
    remove(id) { throw new Error('Not implemented'); }
}

module.exports = { BirthdayExclusionRepositoryPort };
