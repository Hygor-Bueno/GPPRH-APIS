/**
 * @fileoverview Casos de uso — Menus e Log Menus EPP.
 *
 * Orquestra a porta de repositório; os guards de existência/vínculo exigem
 * I/O e por isso ficam aqui (não em domínio puro).
 *
 * @module modules/global/application/epp/menu/menu.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

class EppMenuUseCases {
    /** @param {{repository: import('./ports/menu-repository.port').MenuRepositoryPort}} deps */
    constructor({ repository }) {
        this.repository = repository;
    }

    // ─── Menus ────────────────────────────────────────────────────────────────

    async getMenus() {
        return this.repository.findActiveMenus();
    }

    async getMenusAll() {
        return this.repository.findAllMenus();
    }

    async searchMenus(filters) {
        return this.repository.searchMenus(filters);
    }

    async createMenu({ description, status = 1 }) {
        const result = await this.repository.insertMenu({ description, status });
        return this.repository.findMenuById(result.insertId);
    }

    async updateMenu(id, { description, status }) {
        const { updated } = await this.repository.updateMenu(id, { description, status });
        if (updated === 0) throw new AppError('Menu não encontrado', 404);
        return this.repository.findMenuById(id);
    }

    async deleteMenu(id) {
        const exists = await this.repository.menuExists(id);
        if (!exists) throw new AppError('Menu não encontrado', 404);

        const linked = await this.repository.hasLinkedLogMenus(id);
        if (linked) throw new AppError('Menu possui itens configurados e não pode ser excluído', 409);

        await this.repository.deleteMenu(id);
        return { deleted: true };
    }

    // ─── Log Menus ────────────────────────────────────────────────────────────

    async getLogMenus() {
        return this.repository.findLogMenus();
    }

    async getLogMenusByPlu(pluMenu) {
        return this.repository.findLogMenusByPlu(pluMenu);
    }

    async createLogMenu({ epp_id_menu, epp_id_product, plu_menu, type_base = null, status_log_menu = 1 }) {
        const result = await this.repository.insertLogMenu({
            epp_id_menu, epp_id_product, plu_menu, type_base, status_log_menu
        });
        return this.repository.findLogMenuById(result.insertId);
    }

    async updateLogMenu(id, { epp_id_menu, epp_id_product, plu_menu, type_base = null, status_log_menu }) {
        const { updated } = await this.repository.updateLogMenu(id, {
            epp_id_menu, epp_id_product, plu_menu, type_base, status_log_menu
        });
        if (updated === 0) throw new AppError('Item de menu não encontrado', 404);
        return this.repository.findLogMenuById(id);
    }

    async deleteLogMenuById(id) {
        const { deleted } = await this.repository.deleteLogMenuById(id);
        if (deleted === 0) throw new AppError('Item de menu não encontrado', 404);
        return { deleted: true };
    }

    async deleteLogMenuByPlu(pluMenu, eppIdMenu) {
        const { deleted } = await this.repository.deleteLogMenuByPlu(pluMenu, eppIdMenu);
        return { deleted };
    }
}

module.exports = { EppMenuUseCases };
