/**
 * @fileoverview Controller de temas GTPP.
 * @module modules/global/controllers/gtpp-theme.controller
 */

'use strict';

const { AppError }  = require('../../../errors/app.error');
const { respond }   = require('../../../utils/respond');
const themeService  = require('../services/gtpp-theme.service');

/**
 * GET /gtpp/themes
 * Retorna temas conforme o parâmetro de filtro:
 * - ?all=true   → todos os temas do sistema
 * - ?id=X       → tema por ID
 * - (padrão)    → temas do usuário autenticado
 */
async function getThemes(req, res) {
    const { all, id } = req.query;

    if (all === 'true' || all === '1') {
        return respond.ok(res, await themeService.getAllThemes());
    }

    if (id) {
        return respond.ok(res, await themeService.getThemeById(parseInt(id, 10)));
    }

    return respond.ok(res, await themeService.getThemesByUser(req.user.id));
}

/**
 * POST /gtpp/themes
 * Cria um novo tema.
 * Body: { description_theme }
 */
async function createTheme(req, res) {
    const { description_theme } = req.body;
    const result = await themeService.createTheme(req.user.id, description_theme);
    return respond.created(res, result);
}

/**
 * PUT /gtpp/themes/:id
 * Atualiza a descrição de um tema.
 * Body: { description_theme }
 */
async function updateTheme(req, res) {
    const themeId = parseInt(req.params.id, 10);
    const { description_theme } = req.body;
    await themeService.updateTheme(themeId, description_theme);
    return respond.message(res, 'Tema atualizado com sucesso.');
}

/**
 * DELETE /gtpp/themes/:id
 * Remove um tema permanentemente.
 */
async function deleteTheme(req, res) {
    const themeId = parseInt(req.params.id, 10);
    await themeService.deleteTheme(themeId);
    return respond.message(res, 'Tema excluído com sucesso.');
}

module.exports = {
    getThemes,
    createTheme,
    updateTheme,
    deleteTheme,
};
