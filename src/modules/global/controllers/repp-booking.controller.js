/**
 * @fileoverview Controller das reservas da REPP (reserva de espaços).
 *
 * O autor de toda ação é `req.user` — nunca um campo do corpo.
 *
 * @module modules/global/controllers/repp-booking.controller
 */

const { ReppBookingUseCases } = require('../application/repp/booking/repp-booking.use-cases');
const { MysqlReppBookingRepository } = require('../infrastructure/repp/mysql-repp-booking.repository');
const { MysqlReppSpaceRepository } = require('../infrastructure/repp/mysql-repp-space.repository');
const { SqlServerReppOrganizationDirectory } = require('../infrastructure/repp/sqlserver-repp-organization.directory');
const { HttpReppEventPublisher } = require('../infrastructure/repp/http-repp-event.publisher');
const { respond } = require('../../../utils/respond');

const useCases = new ReppBookingUseCases({
    bookingRepository: new MysqlReppBookingRepository(),
    spaceRepository: new MysqlReppSpaceRepository(),
    organizationDirectory: new SqlServerReppOrganizationDirectory(),
    eventPublisher: new HttpReppEventPublisher(),
});

/** @route GET /spaces/bookings?start=&end=&space_id= — público, mascarado conforme quem consulta. */
async function list(req, res) {
    return respond.ok(res, await useCases.list({ query: req.query, user: req.user }));
}

/** @route GET /spaces/bookings/:id — público, mascarado conforme quem consulta. */
async function getById(req, res) {
    return respond.ok(res, await useCases.getById({ id: req.params.id, user: req.user }));
}

/** @route GET /spaces/bookings/mine?status=&start=&end=&space_id=&page=&limit= */
async function listMine(req, res) {
    return respond.ok(res, await useCases.listMine({ query: req.query, user: req.user }));
}

/** @route GET /spaces/bookings/pending */
async function listPending(req, res) {
    return respond.ok(res, await useCases.listPending({ user: req.user }));
}

/** @route POST /spaces/bookings */
async function create(req, res) {
    return respond.created(res, await useCases.create({ input: req.body ?? {}, user: req.user }));
}

/** @route PUT /spaces/bookings/:id */
async function update(req, res) {
    return respond.ok(res, await useCases.update({ id: req.params.id, input: req.body ?? {}, user: req.user }));
}

/** @route PATCH /spaces/bookings/:id/cancel  body: `{ reason? }` */
async function cancel(req, res) {
    return respond.ok(res, await useCases.cancel({ id: req.params.id, reason: req.body?.reason, user: req.user }));
}

/** @route PATCH /spaces/bookings/:id/approve */
async function approve(req, res) {
    return respond.ok(res, await useCases.approve({ id: req.params.id, user: req.user }));
}

/** @route PATCH /spaces/bookings/:id/reject  body: `{ reason? }` */
async function reject(req, res) {
    return respond.ok(res, await useCases.reject({ id: req.params.id, reason: req.body?.reason, user: req.user }));
}

module.exports = { list, getById, listMine, listPending, create, update, cancel, approve, reject };
