/**
 * @fileoverview Controller de Menus e Log Menus EPP.
 * @module modules/global/controllers/epp-menu.controller
 */

const { EppMenuService } = require('../services/epp-menu.service');
const { respond }        = require('../../../utils/respond');
const { AppError }       = require('../../../errors/app.error');

const service = new EppMenuService();

// ─── Menus ────────────────────────────────────────────────────────────────────

/**
 * GET /epp/menus
 * Query: ?registration=1 (todos) | ?id_menu=X | ?status=X | ?description=X (busca)
 */
async function getMenus(req, res) {
    const { registration, id_menu, status, description } = req.query;

    if (id_menu || status !== undefined || description) {
        const data = await service.searchMenus({ id_menu, status, description });
        return respond.ok(res, data);
    }

    const data = registration ? await service.getMenusAll() : await service.getMenus();
    respond.ok(res, data);
}

/**
 * POST /epp/menus
 * Body: { description, status? }
 */
async function createMenu(req, res) {
    const { description, status } = req.body;
    if (!description) throw new AppError('Campo obrigatório: description', 400);
    const data = await service.createMenu({ description, status });
    respond.created(res, data);
}

/**
 * PUT /epp/menus/:id
 * Body: { description, status }
 */
async function updateMenu(req, res) {
    const { description, status } = req.body;
    if (!description) throw new AppError('Campo obrigatório: description', 400);
    const data = await service.updateMenu(req.params.id, { description, status });
    respond.ok(res, data);
}

/**
 * DELETE /epp/menus/:id
 */
async function deleteMenu(req, res) {
    await service.deleteMenu(req.params.id);
    respond.message(res, 'Menu excluído com sucesso');
}

// ─── Log Menus ────────────────────────────────────────────────────────────────

/**
 * GET /epp/log-menus
 * Query: ?plu_menu=X (filtra por PLU)
 */
async function getLogMenus(req, res) {
    const { plu_menu } = req.query;
    const data = plu_menu
        ? await service.getLogMenusByPlu(plu_menu)
        : await service.getLogMenus();
    respond.ok(res, data);
}

/**
 * POST /epp/log-menus
 * Body: { epp_id_menu, epp_id_product, plu_menu, type_base?, status_log_menu? }
 */
async function createLogMenu(req, res) {
    const { epp_id_menu, epp_id_product, plu_menu } = req.body;
    if (!epp_id_menu || !epp_id_product || !plu_menu) {
        throw new AppError('Campos obrigatórios: epp_id_menu, epp_id_product, plu_menu', 400);
    }
    const data = await service.createLogMenu(req.body);
    respond.created(res, data);
}

/**
 * PUT /epp/log-menus/:id
 * Body: { epp_id_menu, epp_id_product, plu_menu, type_base?, status_log_menu }
 */
async function updateLogMenu(req, res) {
    const { epp_id_menu, epp_id_product, plu_menu } = req.body;
    if (!epp_id_menu || !epp_id_product || !plu_menu) {
        throw new AppError('Campos obrigatórios: epp_id_menu, epp_id_product, plu_menu', 400);
    }
    const data = await service.updateLogMenu(req.params.id, req.body);
    respond.ok(res, data);
}

/**
 * DELETE /epp/log-menus/:id
 */
async function deleteLogMenuById(req, res) {
    await service.deleteLogMenuById(req.params.id);
    respond.message(res, 'Item de menu excluído com sucesso');
}

/**
 * DELETE /epp/log-menus/menu
 * Body: { plu_menu, epp_id_menu }
 */
async function deleteLogMenuByPlu(req, res) {
    const { plu_menu, epp_id_menu } = req.body;
    if (!plu_menu || !epp_id_menu) {
        throw new AppError('Campos obrigatórios: plu_menu, epp_id_menu', 400);
    }
    const data = await service.deleteLogMenuByPlu(plu_menu, epp_id_menu);
    respond.ok(res, data);
}

module.exports = {
    getMenus,
    createMenu,
    updateMenu,
    deleteMenu,
    getLogMenus,
    createLogMenu,
    updateLogMenu,
    deleteLogMenuById,
    deleteLogMenuByPlu,
};
