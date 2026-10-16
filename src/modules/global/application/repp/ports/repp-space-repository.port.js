/**
 * @fileoverview Porta de `re_spaces` + `re_space_admins` +
 * `re_space_unblocked_dates`.
 *
 * Compartilhada pelos casos de uso de espaço e de reserva (os dois precisam
 * saber quem administra o quê), daí o prefixo da suite.
 *
 * @module modules/global/application/repp/ports/repp-space-repository.port
 */

/**
 * @typedef {object} ReppSpace
 * @property {number} id
 * @property {string} name
 * @property {?string} description
 * @property {number[]} blocked_weekdays  ISO (1 = segunda … 7 = domingo); `[]` = nenhum.
 * @property {number} setup_minutes       folga de organização; 0 = nenhuma.
 * @property {boolean} active
 */

class ReppSpaceRepositoryPort {
    /** Espaços ativos, por nome. @returns {Promise<ReppSpace[]>} */
    listActive() { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<?ReppSpace>} inclusive inativo. */
    findById(id) { throw new Error('Not implemented'); }

    /**
     * Ids dos espaços que o usuário administra (`re_space_admins`), ativos ou não.
     * @param {number} userId @returns {Promise<number[]>}
     */
    findManagedSpaceIds(userId) { throw new Error('Not implemented'); }

    /**
     * Quem administra o espaço (`re_space_admins`) — destinatários dos avisos
     * `requested` e `created`. Só usuários ativos.
     * @param {number} spaceId @returns {Promise<number[]>}
     */
    findAdminIds(spaceId) { throw new Error('Not implemented'); }

    /**
     * Datas liberadas (`YYYY-MM-DD`) de `fromDate` em diante, por espaço.
     * Todo id pedido sai no mapa, com `[]` quando não há data.
     * @param {number[]} spaceIds @param {string} fromDate
     * @returns {Promise<Map<number, string[]>>}
     */
    listUnblockedDates(spaceIds, fromDate) { throw new Error('Not implemented'); }

    /** @param {number} spaceId @param {string} date @returns {Promise<boolean>} */
    isDateUnblocked(spaceId, date) { throw new Error('Not implemented'); }

    /** Idempotente. @param {number} spaceId @param {string} date @param {number} userId */
    addUnblockedDate(spaceId, date, userId) { throw new Error('Not implemented'); }

    /** Idempotente (data não liberada não é erro). @param {number} spaceId @param {string} date */
    removeUnblockedDate(spaceId, date) { throw new Error('Not implemented'); }

    /**
     * Administradores do espaço, por nome. `since` = hora local sem fuso;
     * `added_by` nulo = vínculo criado antes da API (por SQL).
     * @param {number} spaceId
     * @returns {Promise<{user_id: number, name: string, login: string, ad_status: string, since: string, added_by: ?number, added_by_name: ?string}[]>}
     */
    listAdmins(spaceId) { throw new Error('Not implemented'); }

    /** @param {number} userId @returns {Promise<?{id: number, ad_status: string}>} */
    findUserStatus(userId) { throw new Error('Not implemented'); }

    /** Idempotente. @param {number} spaceId @param {number} userId @param {number} createdBy */
    addAdmin(spaceId, userId, createdBy) { throw new Error('Not implemented'); }

    /**
     * Remove sob trava do espaço. `assertRemovable(admins)` recebe os
     * administradores atuais (`{user_id, ad_status}[]`) e lança para recusar.
     * @param {number} spaceId @param {number} userId
     * @param {(admins: {user_id: number, ad_status: string}[]) => void} assertRemovable
     * @returns {Promise<number>} linhas apagadas (0 = não era administrador).
     */
    removeAdmin(spaceId, userId, assertRemovable) { throw new Error('Not implemented'); }
}

module.exports = { ReppSpaceRepositoryPort };
