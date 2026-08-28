/**
 * @fileoverview Adapter MySQL — implementa `MenuRepositoryPort`.
 *
 * Reaproveita os builders de SQL puro existentes em
 * `repositories/mysql/epp.queries.js` (inalterados, exceto adições
 * aditivas de existence-check/refetch).
 *
 * @module modules/global/infrastructure/epp/mysql-menu.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { MenuRepositoryPort } = require('../../application/epp/menu/ports/menu-repository.port');
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
    SQL_CHECK_MENU_EXISTS,
    SQL_CHECK_MENU_LINKED_LOG_MENUS,
    SQL_GET_MENU_BY_ID,
    SQL_GET_LOG_MENU_BY_ID,
} = require('../../repositories/mysql/epp.queries');

class MysqlMenuRepository extends MenuRepositoryPort {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'EPP_MENU_MYSQL_ERROR',
                details: error
            });
        }
    }

    async findActiveMenus() {
        const [rows] = await this._query(SQL_GET_MENUS_ACTIVE);
        return rows;
    }

    async findAllMenus() {
        const [rows] = await this._query(SQL_GET_MENUS_ALL);
        return rows;
    }

    async searchMenus(filters) {
        const { sql, params } = sqlSearchMenus(filters);
        const [rows] = await this._query(sql, params);
        return rows;
    }

    async menuExists(id) {
        const [rows] = await this._query(SQL_CHECK_MENU_EXISTS, [id]);
        return Boolean(rows[0]);
    }

    async findMenuById(id) {
        const [rows] = await this._query(SQL_GET_MENU_BY_ID, [id]);
        return rows[0];
    }

    async insertMenu({ description, status }) {
        const [result] = await this._query(SQL_INSERT_MENU, [description, status]);
        return result;
    }

    async updateMenu(id, { description, status }) {
        const [result] = await this._query(SQL_UPDATE_MENU, [description, status, id]);
        return { updated: result.affectedRows };
    }

    async hasLinkedLogMenus(id) {
        const [rows] = await this._query(SQL_CHECK_MENU_LINKED_LOG_MENUS, [id]);
        return Boolean(rows[0]);
    }

    async deleteMenu(id) {
        await this._query(SQL_DELETE_MENU, [id]);
    }

    async findLogMenus() {
        const [rows] = await this._query(SQL_GET_LOG_MENUS);
        return rows;
    }

    async findLogMenusByPlu(pluMenu) {
        const [rows] = await this._query(SQL_GET_LOG_MENUS_BY_PLU, [pluMenu]);
        return rows;
    }

    async findLogMenuById(id) {
        const [rows] = await this._query(SQL_GET_LOG_MENU_BY_ID, [id]);
        return rows[0];
    }

    async insertLogMenu({ epp_id_menu, epp_id_product, plu_menu, type_base, status_log_menu }) {
        const [result] = await this._query(SQL_INSERT_LOG_MENU, [
            epp_id_menu, epp_id_product, plu_menu, type_base, status_log_menu
        ]);
        return result;
    }

    async updateLogMenu(id, { epp_id_menu, epp_id_product, plu_menu, type_base, status_log_menu }) {
        const [result] = await this._query(SQL_UPDATE_LOG_MENU, [
            epp_id_menu, epp_id_product, plu_menu, type_base, status_log_menu, id
        ]);
        return { updated: result.affectedRows };
    }

    async deleteLogMenuById(id) {
        const [result] = await this._query(SQL_DELETE_LOG_MENU_BY_ID, [id]);
        return { deleted: result.affectedRows };
    }

    async deleteLogMenuByPlu(pluMenu, eppIdMenu) {
        const [result] = await this._query(SQL_DELETE_LOG_MENU_BY_PLU, [pluMenu, eppIdMenu]);
        return { deleted: result.affectedRows };
    }
}

module.exports = { MysqlMenuRepository };
