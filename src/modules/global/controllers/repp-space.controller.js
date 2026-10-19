/**
 * @fileoverview Controller dos espaços da REPP (reserva de espaços).
 *
 * @module modules/global/controllers/repp-space.controller
 */

const { ReppSpaceUseCases } = require('../application/repp/space/repp-space.use-cases');
const { MysqlReppSpaceRepository } = require('../infrastructure/repp/mysql-repp-space.repository');
const { respond } = require('../../../utils/respond');

const useCases = new ReppSpaceUseCases({
    spaceRepository: new MysqlReppSpaceRepository(),
});

/** @route GET /spaces — público (`req.user` pode ser `null`). */
async function list(req, res) {
    return respond.ok(res, await useCases.list(req.user));
}

/** @route GET /spaces/me/managed[?include_inactive=true] */
async function listManaged(req, res) {
    const includeInactive = ['true', '1'].includes(String(req.query.include_inactive ?? '').toLowerCase());
    return respond.ok(res, await useCases.listManaged(req.user, { includeInactive }));
}

/** @route POST /spaces */
async function create(req, res) {
    return respond.created(res, await useCases.create({ input: req.body, user: req.user }));
}

/** @route PUT /spaces/:id */
async function update(req, res) {
    return respond.ok(res, await useCases.update({ id: req.params.id, input: req.body, user: req.user }));
}

/** @route POST /spaces/:id/unblocked-dates */
async function unblockDate(req, res) {
    return respond.ok(res, await useCases.unblockDate({ id: req.params.id, date: req.body.date, user: req.user }));
}

/** @route DELETE /spaces/:id/unblocked-dates/:date */
async function reblockDate(req, res) {
    return respond.ok(res, await useCases.reblockDate({ id: req.params.id, date: req.params.date, user: req.user }));
}

/** @route GET /spaces/:id/admins */
async function listAdmins(req, res) {
    return respond.ok(res, await useCases.listAdmins({ id: req.params.id, user: req.user }));
}

/** @route POST /spaces/:id/admins */
async function addAdmin(req, res) {
    return respond.ok(res, await useCases.addAdmin({ id: req.params.id, userId: req.body.user_id, user: req.user }));
}

/** @route DELETE /spaces/:id/admins/:userId */
async function removeAdmin(req, res) {
    return respond.ok(res, await useCases.removeAdmin({ id: req.params.id, userId: req.params.userId, user: req.user }));
}

module.exports = { list, listManaged, create, update, unblockDate, reblockDate, listAdmins, addAdmin, removeAdmin };
