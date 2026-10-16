/**
 * @fileoverview Controller dos ajustes de ponto.
 *
 * O autor é SEMPRE `req.user` — nunca um campo do corpo.
 *
 * @module modules/global/controllers/cppp-adjustment.controller
 */

const { adjustmentUseCases } = require('../infrastructure/cppp/cppp-services');
const { respond } = require('../../../utils/respond');

/**
 * @route POST /cppp/adjustments
 * @description JSON, ou multipart com o anexo no campo `file`. Responde 201
 * com o ajuste e o DIA recalculado — a tela tira a ocorrência da lista com
 * isso, sem recarregar.
 */
async function create(req, res) {
    const result = await adjustmentUseCases.create({ input: req.body, file: req.file ?? null, actor: req.user });
    return respond.created(res, result);
}

/** @route PATCH /cppp/adjustments/:id/cancel  body: `{ reason }` */
async function cancel(req, res) {
    const result = await adjustmentUseCases.cancel({ id: req.params.id, reason: req.body.reason, actor: req.user });
    return respond.ok(res, result);
}

/** @route GET /cppp/adjustments?cpf=&from=&to=&type=&include_canceled=1&page=&limit= */
async function list(req, res) {
    return respond.ok(res, await adjustmentUseCases.list(req.query));
}

/**
 * @route GET /cppp/adjustments/:id/attachment
 * @description Atestado é dado de saúde: sem cache em lugar nenhum.
 */
async function attachment(req, res) {
    const file = await adjustmentUseCases.attachment(req.params.id);
    res.set('Cache-Control', 'private, no-store');
    res.type(file.mimeType);
    return res.sendFile(file.absolutePath, { cacheControl: false });
}

module.exports = { create, cancel, list, attachment };
