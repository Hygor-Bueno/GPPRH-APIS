const { respond } = require('../../../utils/respond');
const { PayeeUseCases } = require('../application/payee/payee.use-cases');
const { SqlServerPayeeRepository } = require('../infrastructure/payee/sqlserver-payee.repository');

const useCases = new PayeeUseCases({ repository: new SqlServerPayeeRepository() });

async function getPayees(req, res) {
    const q = req.query;
    const filters = {};

    if (q.id        !== undefined) filters.id        = Number(q.id);
    if (q.type      !== undefined) filters.type      = q.type;
    if (q.name      !== undefined) filters.name      = q.name;
    if (q.document  !== undefined) filters.document  = q.document;
    if (q.is_active !== undefined) filters.is_active = q.is_active === 'true' ? 1 : 0;

    const data = await useCases.getPayees(filters);
    return respond.ok(res, data);
}

async function postPayee(req, res) {
    const { user, body } = req;

    const payload = {
        type:                   body.type,
        name:                   body.name,
        document:               body.document,
        email:                  body.email,
        phone:                  body.phone,
        is_active:              body.is_active,
        created_by:             user.registration,
        created_by_branch_code: user.branch_code
    };

    const payee = await useCases.createPayee(payload);
    return respond.created(res, payee);
}

async function putPayee(req, res) {
    const { user, body } = req;

    const payload = {
        id:                     body.id,
        type:                   body.type,
        name:                   body.name,
        document:               body.document,
        email:                  body.email,
        phone:                  body.phone,
        is_active:              body.is_active,
        updated_by:             user.registration,
        updated_by_branch_code: user.branch_code
    };

    const payee = await useCases.replacePayee(payload);
    return respond.ok(res, payee);
}

async function patchPayee(req, res) {
    const { user, body } = req;
    const { id, ...fields } = body;

    const payee = await useCases.patchPayee(id, fields, user.registration, user.branch_code);
    return respond.ok(res, payee);
}

async function deletePayee(req, res) {
    const id = Number(req.params.id);
    const result = await useCases.deletePayee(id);
    return respond.ok(res, result);
}

module.exports = { getPayees, postPayee, putPayee, patchPayee, deletePayee };
