/**
 * @fileoverview Porta (contrato) de persistência dos identificadores do ativo.
 *
 * @module modules/global/application/gapp/active-identifier/ports/active-identifier-repository.port
 */

class ActiveIdentifierRepositoryPort {
    /** @returns {Promise<boolean>} ativo existe e é do grupo de trabalho */
    activeInGroup(activeId, workGroupFk) { throw new Error('Not implemented'); }

    /** @returns {Promise<object[]>} identificadores do ativo, principal primeiro */
    listByActive(activeId) { throw new Error('Not implemented'); }

    /** @returns {Promise<object|null>} */
    findById(identifierId, activeId) { throw new Error('Not implemented'); }

    /** @returns {Promise<{ identifier_id: number, active_id_fk: number }|null>} quem já usa o tipo + valor */
    findByValue(type, value) { throw new Error('Not implemented'); }

    /** @returns {Promise<{ insertId: number }>} */
    insert(activeId, type, value) { throw new Error('Not implemented'); }

    /** Marca `identifierId` como o único principal do ativo. */
    setPrimary(identifierId, activeId) { throw new Error('Not implemented'); }

    /** @returns {Promise<{ deleted: number }>} */
    delete(identifierId, activeId) { throw new Error('Not implemented'); }
}

module.exports = { ActiveIdentifierRepositoryPort };
