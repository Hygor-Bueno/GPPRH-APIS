const { GippUseCases } = require('../application/gipp.use-cases');
const { SqlServerGippRepository } = require('../infrastructure/sqlserver-gipp.repository');
const { MysqlGippReplicationRepository } = require('../infrastructure/mysql-gipp-replication.repository');
const { respond } = require('../../../utils/respond');
const { BadRequestError } = require('../../../errors/bad-request.error');

const useCases = new GippUseCases({
    repository: new SqlServerGippRepository(),
    replicationRepository: new MysqlGippReplicationRepository(),
});

async function getStatus(req, res) {
    const data = await useCases.getStatus();
    return respond.ok(res, data);
}

async function getPaymentRegistered(req, res) {
    const data = await useCases.getPaymentRegistered();
    return respond.ok(res, data);
}

async function getRecordTypes(req, res) {
    const data = await useCases.getRecordTypes();
    return respond.ok(res, data);
}

async function getTimeRecords(req, res) {
    const { codWorkSchedule } = req.query;

    // Se vier codWorkSchedule busca os detalhes daquela jornada específica
    // Caso contrário busca com filtros paginados
    const data = codWorkSchedule
        ? await useCases.getTimeRecordsByCodWork(codWorkSchedule)
        : await useCases.getTimeRecords(req.query);

    return respond.ok(res, data);
}

async function postTimeRecord(req, res) {
    const { user, body } = req;

    if (!body.employee_id || !body.id_record_type_fk || !body.branch_time_record) {
        throw new BadRequestError('employee_id, id_record_type_fk and branch_time_record are required');
    }

    const data = await useCases.insertTimeRecord(body, user.id);
    return respond.created(res, data);
}

async function putTimeRecord(req, res) {
    const { user, body } = req;

    if (!body.times || !body.id_time_records) {
        throw new BadRequestError("Provide 'times' and 'id_time_records' to update a time record");
    }

    const data = await useCases.updateTimeRecord(body, user.id);
    return respond.ok(res, data);
}

async function discardTimeRecord(req, res) {
    const { body } = req;

    if (!body.cod_work_schedule) {
        throw new BadRequestError("Provide 'cod_work_schedule' to discard a work schedule");
    }

    await useCases.cancelWorkSchedule(body.cod_work_schedule);
    return respond.message(res, 'Work schedule discarded successfully');
}

async function postPayments(req, res) {
    const { user, body } = req;
    const { codWorkSchedules } = body;

    if (!codWorkSchedules?.length) {
        throw new BadRequestError('codWorkSchedules is required and must not be empty');
    }

    const data = await useCases.processWorkSchedules(
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

    const results = await useCases.closeWorkSchedules(
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
