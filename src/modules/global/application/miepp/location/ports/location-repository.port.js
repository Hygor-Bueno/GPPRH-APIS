/**
 * @fileoverview Porta de `miepp_locations`.
 *
 * Usada só pela sub-feature `location`, então não leva o prefixo da suite
 * (convenção da migração GTPP).
 *
 * @module modules/global/application/miepp/location/ports/location-repository.port
 */

class LocationRepositoryPort {
    /** @param {object} filters @returns {Promise<{rows: object[], total: number}>} */
    list(filters) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /** @param {object} payload @returns {Promise<number>} */
    create(payload) { throw new Error('Not implemented'); }

    /** @param {number} id @param {object} payload @returns {Promise<void>} */
    update(id, payload) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<void>} */
    remove(id) { throw new Error('Not implemented'); }
}

module.exports = { LocationRepositoryPort };
