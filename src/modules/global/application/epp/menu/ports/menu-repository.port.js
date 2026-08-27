/**
 * @fileoverview Porta (contrato) de persistência para menus e log_menus EPP.
 *
 * @module modules/global/application/epp/menu/ports/menu-repository.port
 */

class MenuRepositoryPort {
    /** @returns {Promise<object[]>} Menus ativos. */
    findActiveMenus() { throw new Error('Not implemented'); }

    /** @returns {Promise<object[]>} Todos os menus. */
    findAllMenus() { throw new Error('Not implemented'); }

    /** @param {{id_menu?, status?, description?}} filters */
    searchMenus(filters) { throw new Error('Not implemented'); }

    /** @param {number} id */
    menuExists(id) { throw new Error('Not implemented'); }

    /** @param {number} id */
    findMenuById(id) { throw new Error('Not implemented'); }

    /** @param {{description: string, status: number}} fields */
    insertMenu(fields) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {{description: string, status: number}} fields
     * @returns {Promise<{updated: number}>}
     */
    updateMenu(id, fields) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<boolean>} */
    hasLinkedLogMenus(id) { throw new Error('Not implemented'); }

    /** @param {number} id */
    deleteMenu(id) { throw new Error('Not implemented'); }

    /** @returns {Promise<object[]>} */
    findLogMenus() { throw new Error('Not implemented'); }

    /** @param {number} pluMenu */
    findLogMenusByPlu(pluMenu) { throw new Error('Not implemented'); }

    /** @param {number} id */
    findLogMenuById(id) { throw new Error('Not implemented'); }

    /** @param {object} fields */
    insertLogMenu(fields) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {object} fields
     * @returns {Promise<{updated: number}>}
     */
    updateLogMenu(id, fields) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<{deleted: number}>} */
    deleteLogMenuById(id) { throw new Error('Not implemented'); }

    /**
     * @param {number} pluMenu
     * @param {number} eppIdMenu
     * @returns {Promise<{deleted: number}>}
     */
    deleteLogMenuByPlu(pluMenu, eppIdMenu) { throw new Error('Not implemented'); }
}

module.exports = { MenuRepositoryPort };
