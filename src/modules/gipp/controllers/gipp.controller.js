const { GippUseCases } = require('../application/gipp.use-cases');
const { SqlServerGippRepository } = require('../infrastructure/sqlserver-gipp.repository');
const { MysqlGippReplicationRepository } = require('../infrastructure/mysql-gipp-replication.repository');
const { respond } = require('../../../utils/respond');
const { BadRequestError } = require('../../../errors/bad-request.error');
const {
    DISCARDABLE_STATUSES,
    PAYROLL_DISCARDABLE_STATUSES,
} = require('../domain/work-schedule-status');
const { appendCloseAudit } = require('../infrastructure/csv-close-audit.logger');

const useCases = new GippUseCases({
    repository: new SqlServerGippRepository(),
    replicationRepository: new MysqlGippReplicationRepository(),
});

async function getStatus(req, res) {
    const data = await useCases.getStatus();
    return respond.ok(res, data);
}

// Aceita os nomes das colunas da view (branch_cod / cost_center) como alias dos
// params camelCase usados nas outras rotas, pra não obrigar o front a traduzir.
async function getPaymentRegistered(req, res) {
    const { branch, branch_cod, costCenter, cost_center } = req.query;

    const data = await useCases.getPaymentRegistered({
        branch: branch ?? branch_cod,
        costCenter: costCenter ?? cost_center,
    });

    return respond.ok(res, data);
}

// Aceitam os mesmos alias de `getPaymentRegistered` (branch_cod / cost_center),
// pra que o front possa trocar de fila sem reescrever a montagem da query.
async function getPendingApproval(req, res) {
    const { branch, branch_cod, costCenter, cost_center } = req.query;

    const data = await useCases.getPendingApproval({
        branch: branch ?? branch_cod,
        costCenter: costCenter ?? cost_center,
    });

    return respond.ok(res, data);
}

async function getApprovedPayments(req, res) {
    const { branch, branch_cod, costCenter, cost_center } = req.query;

    const data = await useCases.getApprovedPayments({
        branch: branch ?? branch_cod,
        costCenter: costCenter ?? cost_center,
    });

    return respond.ok(res, data);
}

/** Permissões que autorizam consultar os lançamentos de outra pessoa. */
const CAN_VIEW_OTHER_LAUNCHERS = ['GIPP_MANAGE_TIMERECORD', 'GIPP_MANAGE_PAYMENT', 'SYSTEM_OWNER'];

/**
 * Jornadas lançadas pelo próprio usuário (status 1 e 2).
 *
 * O identificador sai do token, não do cliente: `id_global` gravado em
 * cf_time_records é o mesmo `req.user.id` que autenticou. Aceitar o id por
 * parâmetro deixaria um encarregado consultar os lançamentos de outro apenas
 * trocando o número — que é justamente o que esta rota existe para evitar.
 *
 * `?launched_by=` só é respeitado para quem tem permissão de gestão, para que
 * RH e supervisão consigam auditar sem precisar de outra rota.
 */
async function getPaymentByLauncher(req, res) {
    const { user, query } = req;
    const permissions = user?.permissions || [];

    const canOverride = CAN_VIEW_OTHER_LAUNCHERS.some(p => permissions.includes(p));
    const requested = query.launched_by ?? query.launchedBy;

    const launchedBy = (canOverride && requested) ? requested : user.id;

    const data = await useCases.getPaymentByLauncher(launchedBy, {
        branch: query.branch ?? query.branch_cod,
        costCenter: query.costCenter ?? query.cost_center,
    });

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
        throw new BadRequestError('Informe employee_id, id_record_type_fk e branch_time_record.');
    }

    const data = await useCases.insertTimeRecord(body, user.id);
    return respond.created(res, data);
}

async function putTimeRecord(req, res) {
    const { user, body } = req;

    if (!body.times || !body.id_time_records) {
        throw new BadRequestError('Informe times e id_time_records para atualizar a marcação.');
    }

    const data = await useCases.updateTimeRecord(body, user.id);
    return respond.ok(res, data);
}

/** Permissões que alcançam também a jornada já aprovada (status 3). */
const CAN_DISCARD_APPROVED = ['GIPP_CREATE_PAYMENT', 'GIPP_MANAGE_PAYMENT', 'SYSTEM_OWNER'];

async function discardTimeRecord(req, res) {
    const { body, user } = req;

    if (!body.cod_work_schedule) {
        throw new BadRequestError('Informe cod_work_schedule para desconsiderar a jornada.');
    }

    // Encarregado e gerente desconsideram o que ainda não foi aprovado (1 e 2).
    // O RH alcança também a jornada aprovada (3), que está na fila dele e ainda
    // não virou recibo — é a via de estorno antes da finalização.
    const permissions = user?.permissions || [];
    const allowedStatuses = CAN_DISCARD_APPROVED.some(p => permissions.includes(p))
        ? PAYROLL_DISCARDABLE_STATUSES
        : DISCARDABLE_STATUSES;

    await useCases.cancelWorkSchedule(body.cod_work_schedule, allowedStatuses);
    return respond.message(res, 'Work schedule discarded successfully');
}

/**
 * Aprovação do gerente — 2 → 3, em lote.
 *
 * Aceita `cod_work_schedules` e `codWorkSchedules`: o app manda snake_case e o
 * web manda camelCase, e não vale quebrar um dos dois por causa da grafia.
 */
async function approveTimeRecords(req, res) {
    const { body } = req;
    const codes = body.cod_work_schedules ?? body.codWorkSchedules;

    if (!Array.isArray(codes) || codes.length === 0) {
        throw new BadRequestError('Informe ao menos uma jornada em cod_work_schedules.');
    }

    const result = await useCases.approveWorkSchedules(codes);

    return respond.ok(res, {
        message: `${result.approved.length} jornada(s) aprovada(s), ${result.skipped.length} ignorada(s).`,
        ...result,
    });
}

async function postPayments(req, res) {
    const { user, body } = req;
    // O app envia `cod_work_schedules` e o web envia `codWorkSchedules`. Até
    // 08/2026 só a segunda era lida, então o processamento em lote pelo celular
    // respondia 400 sempre.
    const codWorkSchedules = body.cod_work_schedules ?? body.codWorkSchedules;

    if (!codWorkSchedules?.length) {
        throw new BadRequestError('Informe ao menos uma jornada em cod_work_schedules.');
    }

    const data = await useCases.processWorkSchedules(
        codWorkSchedules,
        user.registration,
        user.branch_code
    );

    // `processWorkSchedules` chama `closeWorkSchedules` internamente — o
    // resultado por jornada vem em `data.closing`.
    appendCloseAudit({
        results: data.closing,
        userId: user.registration,
        branchCode: user.branch_code,
    });

    return respond.ok(res, { message: 'Final markings completed successfully', data });
}

async function postPaymentsClose(req, res) {
    const { body, user } = req;
    const codWorkSchedules = body.cod_work_schedules ?? body.codWorkSchedules;

    if (!codWorkSchedules?.length) {
        throw new BadRequestError('Informe ao menos uma jornada em cod_work_schedules.');
    }

    const results = await useCases.closeWorkSchedules(
        codWorkSchedules,
        user.registration,
        user.branch_code
    );

    appendCloseAudit({
        results,
        userId: user.registration,
        branchCode: user.branch_code,
    });

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
    getPendingApproval,
    getApprovedPayments,
    getPaymentByLauncher,
    getRecordTypes,
    getTimeRecords,
    postTimeRecord,
    putTimeRecord,
    discardTimeRecord,
    approveTimeRecords,
    postPayments,
    postPaymentsClose
};
