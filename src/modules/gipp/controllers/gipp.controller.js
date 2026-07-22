const { GippService } = require('../services/gipp.service');
const { respond } = require('../../../utils/respond');
const { BadRequestError } = require('../../../errors/bad-request.error');

async function getStatus(req, res) {
    const service = new GippService();
    const data = await service.getStatus();
    return respond.ok(res, data);
}

async function getPaymentRegistered(req, res) {
    const service = new GippService();
    const data = await service.getPaymentRegistered();
    return respond.ok(res, data);
}

async function getRecordTypes(req, res) {
    const service = new GippService();
    const data = await service.getRecordTypes();
    return respond.ok(res, data);
}

async function getTimeRecords(req, res) {
    const { codWorkSchedule } = req.query;
    const service = new GippService();

    // Se vier codWorkSchedule busca os detalhes daquela jornada específica
    // Caso contrário busca com filtros paginados
    const data = codWorkSchedule
        ? await service.getTimeRecordsByCodWork(codWorkSchedule)
        : await service.getTimeRecords(req.query);

    return respond.ok(res, data);
}

async function postTimeRecord(req, res) {
    const { user, body } = req;

    if (!body.employee_id || !body.id_record_type_fk || !body.branch_time_record) {
        throw new BadRequestError('employee_id, id_record_type_fk and branch_time_record are required');
    }

    const service = new GippService();
    const data = await service.insertTimeRecord(body, user.id);
    return respond.created(res, data);
}

async function putTimeRecord(req, res) {
    const { user, body } = req;
    const service = new GippService();

    if (!body.times || !body.id_time_records) {
        throw new BadRequestError("Provide 'times' and 'id_time_records' to update a time record");
    }

    const data = await service.updateTimeRecord(body, user.id);
    return respond.ok(res, data);
}

async function discardTimeRecord(req, res) {
    const { body } = req;
    const service = new GippService();

    if (!body.cod_work_schedule) {
        throw new BadRequestError("Provide 'cod_work_schedule' to discard a work schedule");
    }

    await service.cancelWorkSchedule(body.cod_work_schedule);
    return respond.message(res, 'Work schedule discarded successfully');
}

async function postPayments(req, res) {
    const { user, body } = req;
    const { codWorkSchedules } = body;

    if (!codWorkSchedules?.length) {
        throw new BadRequestError('codWorkSchedules is required and must not be empty');
    }

    const service = new GippService();
    const data = await service.processWorkSchedules(
        codWorkSchedules,
        user.registration,
        user.branch_code
    );
    return respond.ok(res, { message: 'Final markings completed successfully', data });
}

async function postPaymentsClose(req, res) {
    const { codWorkSchedules } = req.body;
    const { user } = req;

    if (!codWorkSchedules?.length) {
        throw new BadRequestError('codWorkSchedules is required and must not be empty');
    }

    const service = new GippService();
    const results = await service.closeWorkSchedules(
        codWorkSchedules,
        user.registration,
        user.branch_code
    );

    const inserted = results.filter(r => r.status === 'inserted').length;
    const skipped  = results.filter(r => r.status === 'skipped').length;

    return respond.ok(res, {
        message: `Fechamento concluído: ${inserted} jornada(s) inserida(s), ${skipped} ignorada(s).`,
        results
    });
}

module.exports = {
    getStatus,
    getPaymentRegistered,
    getRecordTypes,
    getTimeRecords,
    postTimeRecord,
    putTimeRecord,
    discardTimeRecord,
    postPayments,
    postPaymentsClose
};
