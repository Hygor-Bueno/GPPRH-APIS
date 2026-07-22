/**
 * @fileoverview Serviço de Menus EPP.
 *
 * Gerencia CRUD de menus (cardápios) e de log_menus
 * (configuração de produtos por menu com PLU).
 *
 * @module modules/global/services/epp-menu.service
 */

const { poolGlobal } = require('../../../config/mysql');
const { AppError }   = require('../../../errors/app.error');
const {
    SQL_GET_MENUS_ACTIVE,
    SQL_GET_MENUS_ALL,
    sqlSearchMenus,
    SQL_INSERT_MENU,
    SQL_UPDATE_MENU,
    SQL_DELETE_MENU,
    SQL_GET_LOG_MENUS,
    SQL_GET_LOG_MENUS_BY_PLU,
    SQL_INSERT_LOG_MENU,
    SQL_UPDATE_LOG_MENU,
    SQL_DELETE_LOG_MENU_BY_ID,
    SQL_DELETE_LOG_MENU_BY_PLU,
} = require('../repositories/mysql/epp.repository');

class EppMenuService {

    // ─── Menus ────────────────────────────────────────────────────────────────

    /** Lista menus ativos. */
    async getMenus() {
        const [rows] = await poolGlobal.query(SQL_GET_MENUS_ACTIVE);
        return rows;
    }

    /** Lista todos os menus (para cadastro/administração). */
    async getMenusAll() {
        const [rows] = await poolGlobal.query(SQL_GET_MENUS_ALL);
        return rows;
    }

    /**
     * Busca menus com filtros opcionais.
     * @param {object} filters - { id_menu?, status?, description? }
     */
    async searchMenus(filters) {
        const { sql, params } = sqlSearchMenus(filters);
        const [rows] = await poolGlobal.query(sql, params);
        return rows;
    }

    /**
     * Cria um novo menu.
     * @param {{ description: string, status?: number }} payload
     * @returns {Promise<object>} Menu criado.
     */
    async createMenu({ description, status = 1 }) {
        const [result] = await poolGlobal.query(SQL_INSERT_MENU, [description, status]);
        const [rows]   = await poolGlobal.query(
            'SELECT id_menu, description, status FROM epp_menu WHERE id_menu = ?',
            [result.insertId]
        );
        return rows[0];
    }

    /**
     * Atualiza um menu.
     * @throws {AppError} 404 se não encontrado.
     */
    async updateMenu(id, { description, status }) {
        const [result] = await poolGlobal.query(SQL_UPDATE_MENU, [description, status, id]);
        if (result.affectedRows === 0) throw new AppError('Menu não encontrado', 404);
        const [rows] = await poolGlobal.query(
            'SELECT id_menu, description, status FROM epp_menu WHERE id_menu = ?', [id]
        );
        return rows[0];
    }

    /**
     * Exclui um menu. Bloqueia se houver log_menus vinculados.
     * @throws {AppError} 404 / 409
     */
    async deleteMenu(id) {
        const [existing] = await poolGlobal.query(
            'SELECT id_menu FROM epp_menu WHERE id_menu = ?', [id]
        );
        if (!existing[0]) throw new AppError('Menu não encontrado', 404);

        const [linked] = await poolGlobal.query(
            'SELECT epp_log_id FROM epp_log_menus WHERE epp_id_menu = ? LIMIT 1', [id]
        );
        if (linked[0]) throw new AppError('Menu possui itens configurados e não pode ser excluído', 409);

        await poolGlobal.query(SQL_DELETE_MENU, [id]);
        return { deleted: true };
    }

    // ─── Log Menus (configuração menu × produto) ──────────────────────────────

    /** Lista todos os itens de menu com dados de produto e menu. */
    async getLogMenus() {
        const [rows] = await poolGlobal.query(SQL_GET_LOG_MENUS);
        return rows;
    }

    /**
     * Lista itens de menu filtrados por PLU.
     * @param {number} pluMenu - Código PLU do menu
     */
    async getLogMenusByPlu(pluMenu) {
        const [rows] = await poolGlobal.query(SQL_GET_LOG_MENUS_BY_PLU, [pluMenu]);
        return rows;
    }

    /**
     * Cria um item de log_menu.
     * @param {{ epp_id_menu, epp_id_product, plu_menu, type_base?, status_log_menu? }} payload
     */
    async createLogMenu({ epp_id_menu, epp_id_product, plu_menu, type_base = null, status_log_menu = 1 }) {
        const [result] = await poolGlobal.query(SQL_INSERT_LOG_MENU, [
            epp_id_menu, epp_id_product, plu_menu, type_base, status_log_menu
        ]);
        const [rows] = await poolGlobal.query(
            'SELECT * FROM epp_log_menus WHERE epp_log_id = ?', [result.insertId]
        );
        return rows[0];
    }

    /**
     * Atualiza um item de log_menu.
     * @throws {AppError} 404 se não encontrado.
     */
    async updateLogMenu(id, { epp_id_menu, epp_id_product, plu_menu, type_base = null, status_log_menu }) {
        const [result] = await poolGlobal.query(SQL_UPDATE_LOG_MENU, [
            epp_id_menu, epp_id_product, plu_menu, type_base, status_log_menu, id
        ]);
        if (result.affectedRows === 0) throw new AppError('Item de menu não encontrado', 404);
        const [rows] = await poolGlobal.query(
            'SELECT * FROM epp_log_menus WHERE epp_log_id = ?', [id]
        );
        return rows[0];
    }

    /**
     * Exclui um item de log_menu pelo ID.
     * @throws {AppError} 404
     */
    async deleteLogMenuById(id) {
        const [result] = await poolGlobal.query(SQL_DELETE_LOG_MENU_BY_ID, [id]);
        if (result.affectedRows === 0) throw new AppError('Item de menu não encontrado', 404);
        return { deleted: true };
    }

    /**
     * Exclui todos os itens de um menu por PLU + menu ID.
     */
    async deleteLogMenuByPlu(pluMenu, eppIdMenu) {
        const [result] = await poolGlobal.query(SQL_DELETE_LOG_MENU_BY_PLU, [pluMenu, eppIdMenu]);
        return { deleted: result.affectedRows };
    }
}

module.exports = { EppMenuService };
