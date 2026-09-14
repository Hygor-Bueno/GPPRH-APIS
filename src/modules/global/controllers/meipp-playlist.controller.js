/**
 * @fileoverview Controller de playlists e seus itens.
 *
 * @module modules/global/controllers/meipp-playlist.controller
 */

const { MeippPlaylistUseCases } = require('../application/meipp/playlist/meipp-playlist.use-cases');
const { MysqlMeippPlaylistRepository } = require('../infrastructure/meipp/mysql-meipp-playlist.repository');
const { MysqlMeippMediaRepository } = require('../infrastructure/meipp/mysql-meipp-media.repository');
const { BadRequestError } = require('../../../errors/bad-request.error');
const { respond } = require('../../../utils/respond');

const useCases = new MeippPlaylistUseCases({
    repository: new MysqlMeippPlaylistRepository(),
    mediaRepository: new MysqlMeippMediaRepository(),
});

async function list(req, res) {
    return respond.ok(res, await useCases.list(req.query));
}

async function getById(req, res) {
    return respond.ok(res, await useCases.getById(Number(req.params.id)));
}

async function create(req, res) {
    return respond.created(res, await useCases.create(req.body, req.meippUser));
}

async function update(req, res) {
    return respond.ok(res, await useCases.update(Number(req.params.id), req.body));
}

async function remove(req, res) {
    return respond.ok(res, await useCases.remove(Number(req.params.id)));
}

async function listItems(req, res) {
    return respond.ok(res, await useCases.listItems(Number(req.params.id)));
}

async function addItem(req, res) {
    return respond.created(res, await useCases.addItem(Number(req.params.id), req.body));
}

async function updateItem(req, res) {
    const result = await useCases.updateItem(
        Number(req.params.id), Number(req.params.itemId), req.body
    );
    return respond.ok(res, result);
}

async function removeItem(req, res) {
    const result = await useCases.removeItem(Number(req.params.id), Number(req.params.itemId));
    return respond.ok(res, result);
}

/**
 * Reordena os itens.
 *
 * A forma da lista é conferida aqui porque o `validate.middleware` da casa só
 * valida campos escalares — ele não tem regra para array. A validação de
 * conteúdo (ids repetidos, ids de outra playlist, lista incompleta) fica no
 * caso de uso, junto do estado do banco que ela precisa consultar.
 *
 * @route PATCH /meipp/playlists/:id/items/reorder
 */
async function reorderItems(req, res) {
    const itemIds = req.body?.item_ids;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
        throw new BadRequestError("O campo 'item_ids' deve ser uma lista não vazia de ids.");
    }

    if (!itemIds.every((id) => Number.isInteger(Number(id)) && Number(id) > 0)) {
        throw new BadRequestError("O campo 'item_ids' deve conter apenas ids numéricos válidos.");
    }

    const result = await useCases.reorderItems(Number(req.params.id), itemIds);
    return respond.ok(res, result);
}

module.exports = {
    list, getById, create, update, remove,
    listItems, addItem, updateItem, removeItem, reorderItems,
};
