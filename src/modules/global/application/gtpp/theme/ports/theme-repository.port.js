/**
 * @fileoverview Porta (contrato) de persistência MySQL para temas GTPP.
 *
 * @module modules/global/application/gtpp/theme/ports/theme-repository.port
 */

class ThemeRepositoryPort {
    findAll() { throw new Error('Not implemented'); }

    /** @param {number} id */
    findById(id) { throw new Error('Not implemented'); }

    /** @param {number} userId */
    findByUser(userId) { throw new Error('Not implemented'); }

    /** @param {string} description @param {number} userId @returns {Promise<{insertId: number}>} */
    insert(description, userId) { throw new Error('Not implemented'); }

    /** @param {number} id @param {string} description @returns {Promise<{updated: number}>} */
    update(id, description) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<{deleted: number}>} */
    remove(id) { throw new Error('Not implemented'); }
}

module.exports = { ThemeRepositoryPort };
