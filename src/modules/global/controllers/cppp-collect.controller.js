/**
 * @fileoverview Controller das coletas do relógio e do AFD bruto.
 *
 * @module modules/global/controllers/cppp-collect.controller
 */

const { collectUseCases } = require('../infrastructure/cppp/cppp-services');
const { respond } = require('../../../utils/respond');

/** @route GET /cppp/devices */
async function listDevices(req, res) {
    return respond.ok(res, await collectUseCases.listDevices());
}

/** @route GET /cppp/devices/:id */
async function getDevice(req, res) {
    return respond.ok(res, await collectUseCases.getDevice(req.params.id));
}

/** @route POST /cppp/devices */
async function createDevice(req, res) {
    return respond.created(res, await collectUseCases.createDevice({ input: req.body, actor: req.user }));
}

/** @route PUT /cppp/devices/:id */
async function updateDevice(req, res) {
    return respond.ok(res, await collectUseCases.updateDevice({ id: req.params.id, input: req.body, actor: req.user }));
}

/**
 * @route POST /cppp/devices/test-connection  body: `{ base_url }`
 * @description IP ainda não salvo. 200 com `ok: false` quando o relógio não
 * responde — falha de conexão é o resultado do teste, não erro da API.
 */
async function testAddress(req, res) {
    return respond.ok(res, await collectUseCases.testAddress(req.body.base_url));
}

/** @route POST /cppp/devices/:id/test-connection */
async function testDevice(req, res) {
    return respond.ok(res, await collectUseCases.testDevice(req.params.id));
}

/** @route GET /cppp/collect-runs?device_id=&status=&page=&limit= */
async function listRuns(req, res) {
    return respond.ok(res, await collectUseCases.listRuns(req.query));
}

/** @route GET /cppp/collect-runs/:id */
async function getRun(req, res) {
    return respond.ok(res, await collectUseCases.getRun(req.params.id));
}

/**
 * @route POST /cppp/collect-runs
 * @description Enfileira; o worker executa em segundos. 201 com a coleta
 * `queued` — a tela acompanha por `GET /collect-runs/:id`.
 */
async function requestCollect(req, res) {
    const run = await collectUseCases.requestCollect({ deviceId: Number(req.body.device_id), actor: req.user });
    return respond.created(res, run);
}

/**
 * @route GET /cppp/collect-runs/:id/afd
 * @description O AFD exatamente como o relógio enviou. `sendFile` não toca no
 * conteúdo; o hash vai no header para quem quiser conferir do outro lado.
 */
async function downloadRawAfd(req, res) {
    const run = await collectUseCases.getRun(req.params.id);
    const file = await collectUseCases.rawAfd(req.params.id);

    res.set('Cache-Control', 'no-store');
    res.set('X-Content-SHA256', run.raw_sha256 ?? '');
    res.attachment(file.fileName);
    return res.sendFile(file.absolutePath, { cacheControl: false, headers: { 'Content-Type': 'text/plain' } });
}

module.exports = {
    listDevices, getDevice, createDevice, updateDevice, testAddress, testDevice,
    listRuns, getRun, requestCollect, downloadRawAfd,
};
