/**
 * Testes do adapter SQL Server do GIPP focados na trilha de auditoria.
 *
 * O pool real é substituído por um dublê: `config/sqlserver` abre conexão no
 * import, então sem o mock o simples `require` do adapter tentaria falar com
 * 10.10.10.51. O `sql` (tipos de parâmetro) vem do `mssql` de verdade — são
 * objetos puros, e é justamente o tipo que queremos verificar.
 */

const mssql = require('mssql');

/** Guarda o SQL e os parâmetros de cada `pool.request()` da rodada. */
const mockCalls = [];

function mockFakeRequest() {
    const inputs = {};
    const request = {
        inputs,
        input(name, type, value) {
            inputs[name] = { type, value };
            return request;
        },
        query: jest.fn(async (sql) => {
            mockCalls.push({ sql, inputs });
            return { recordset: [{ affected_rows: 1 }], rowsAffected: [1] };
        }),
    };
    return request;
}

jest.mock('../../../../config/sqlserver', () => {
    const sql = require('mssql');
    return {
        sql,
        poolPromise: Promise.resolve({ request: () => mockFakeRequest() }),
    };
});

const { SqlServerGippRepository } = require('../sqlserver-gipp.repository');
const { WORK_SCHEDULE_STATUS, DISCARDABLE_STATUSES } = require('../../domain/work-schedule-status');
const { CHANGE_REASON } = require('../../domain/work-schedule-change-reason');

/** Encarregado que lança a marcação. NÃO é o colaborador da jornada. */
const LANCADOR = Object.freeze({
    globalUserId: 397,
    name: 'BERENILDO NOBERTO LINO',
    registration: '002351',
    branchCode: '0202',
});

/** Colaborador da jornada — matrícula e filial deliberadamente diferentes. */
const COLABORADOR = Object.freeze({
    employee_id: '004812',
    branch_time_record: '0208',
});

let repository;

beforeEach(() => {
    mockCalls.length = 0;
    repository = new SqlServerGippRepository();
});

describe('insertTimeRecord', () => {
    const PAYLOAD = {
        ...COLABORADOR,
        id_record_type_fk: 1,
        times: '2026-08-21T08:00:00',
    };

    it('grava os snapshots do LANÇADOR, não do colaborador da jornada', async () => {
        await repository.insertTimeRecord(PAYLOAD, LANCADOR);

        const { inputs } = mockCalls[0];

        // As três colunas descrevem a mesma pessoa: o usuário de id_global.
        expect(inputs.id_global.value).toBe(397);
        expect(inputs.registration_snapshot.value).toBe('002351');
        expect(inputs.branch_code_snapshot.value).toBe('0202');

        // O colaborador viaja em campos próprios e não contamina o snapshot.
        expect(inputs.employee_id.value).toBe('004812');
        expect(inputs.branch_time_record.value).toBe('0208');
        expect(inputs.registration_snapshot.value).not.toBe(COLABORADOR.employee_id);
        expect(inputs.branch_code_snapshot.value).not.toBe(COLABORADOR.branch_time_record);
    });

    it('preserva os zeros à esquerda como string', async () => {
        await repository.insertTimeRecord(PAYLOAD, LANCADOR);

        const { inputs } = mockCalls[0];

        expect(typeof inputs.registration_snapshot.value).toBe('string');
        expect(inputs.registration_snapshot.value).toBe('002351');
        expect(inputs.branch_code_snapshot.value).toBe('0202');
        // VARCHAR(6) e VARCHAR(4) no banco — Int viraria 2351 e 202.
        expect(inputs.registration_snapshot.type.type.declaration).toBe('varchar');
        expect(inputs.branch_code_snapshot.type.type.declaration).toBe('varchar');
    });

    it('envia os dois parâmetros novos para a procedure', async () => {
        await repository.insertTimeRecord(PAYLOAD, LANCADOR);

        expect(mockCalls[0].sql).toContain('@registration_snapshot = @registration_snapshot');
        expect(mockCalls[0].sql).toContain('@branch_code_snapshot  = @branch_code_snapshot');
    });

    it('carimba o responsável no SESSION_CONTEXT do mesmo batch', async () => {
        await repository.insertTimeRecord(PAYLOAD, LANCADOR);

        const { sql, inputs } = mockCalls[0];

        // Um único request → uma única conexão física. É isso que faz o trigger
        // enxergar o contexto: a marcação de entrada cria a jornada e dispara o
        // INITIAL_STATE dentro da mesma procedure.
        expect(mockCalls).toHaveLength(1);
        expect(sql).toContain('sp_set_session_context');
        expect(sql.indexOf('sp_set_session_context'))
            .toBeLessThan(sql.indexOf('prc_insert_cf_time_records'));

        expect(inputs.ctx_globalUserId.value).toBe(397);
        expect(inputs.ctx_userRegistration.value).toBe('002351');
        expect(inputs.ctx_changeSource.value).toBe('BACKEND');
        expect(inputs.ctx_changeReason.value).toBe(CHANGE_REASON.CREATED);
    });

    it('usa o motivo de envio para aprovação quando é a saída (tipo 4)', async () => {
        // A saída dispara pcr_put_status_cf_work_schedule (1 → 2) dentro da
        // procedure, então o evento de histórico é outro.
        await repository.insertTimeRecord({ ...PAYLOAD, id_record_type_fk: 4 }, LANCADOR);

        expect(mockCalls[0].inputs.ctx_changeReason.value).toBe(CHANGE_REASON.SENT_TO_APPROVAL);
    });

    it('limpa o contexto no sucesso e no erro, dentro do próprio batch', async () => {
        await repository.insertTimeRecord(PAYLOAD, LANCADOR);

        const { sql } = mockCalls[0];
        const catchBlock = sql.slice(sql.indexOf('BEGIN CATCH'));

        expect(catchBlock).toContain('@value = NULL');
        expect(sql.slice(sql.indexOf('END CATCH'))).toContain('@value = NULL');
    });
});

describe('updateTimeRecord', () => {
    it('atualiza os snapshots junto com o id_global de quem editou', async () => {
        // A procedure faz id_global = ISNULL(@id_global, id_global): sem mandar
        // os snapshots, a linha ficaria com id_global de um e matrícula de outro.
        const EDITOR = { ...LANCADOR, globalUserId: 412, registration: '000998', branchCode: '0201' };

        await repository.updateTimeRecord({ id_time_records: 7, times: '2026-08-21T17:00:00' }, EDITOR);

        const { inputs } = mockCalls[0];
        expect(inputs.id_global.value).toBe(412);
        expect(inputs.registration_snapshot.value).toBe('000998');
        expect(inputs.branch_code_snapshot.value).toBe('0201');
    });
});

describe('transições de status', () => {
    it('aprovação 2 → 3 leva responsável e motivo', async () => {
        await repository.approveWorkSchedules(
            ['202608210002091981'],
            WORK_SCHEDULE_STATUS.AWAITING_APPROVAL,
            WORK_SCHEDULE_STATUS.AWAITING_PAYROLL,
            { actor: LANCADOR, source: 'BACKEND', reason: CHANGE_REASON.APPROVED_BY_MANAGER },
        );

        const { sql, inputs } = mockCalls[0];
        expect(inputs.from_status.value).toBe(2);
        expect(inputs.to_status.value).toBe(3);
        expect(inputs.ctx_globalUserId.value).toBe(397);
        expect(inputs.ctx_changeReason.value).toBe(CHANGE_REASON.APPROVED_BY_MANAGER);
        expect(sql).toContain('sp_set_session_context');
    });

    it('lote de N jornadas é um UPDATE só — N eventos, um contexto', async () => {
        const lote = ['A', 'B', 'C', 'D'];

        await repository.approveWorkSchedules(lote, 2, 3, { actor: LANCADOR, source: 'BACKEND' });

        // O trigger é baseado em conjunto (FROM inserted): um UPDATE de 4 linhas
        // gera 4 eventos com o mesmo responsável. Um laço por jornada seriam 4
        // conexões e 4 contextos, sem ganho algum.
        expect(mockCalls).toHaveLength(1);
        lote.forEach((code, i) => expect(mockCalls[0].inputs[`ws${i}`].value).toBe(code));
    });

    it('cancelamento leva responsável e motivo de cancelamento', async () => {
        await repository.cancelWorkSchedule('202608210002091981', DISCARDABLE_STATUSES, LANCADOR);

        const { inputs } = mockCalls[0];
        expect(inputs.st_cancelled.value).toBe(WORK_SCHEDULE_STATUS.CANCELLED);
        expect(inputs.ctx_globalUserId.value).toBe(397);
        expect(inputs.ctx_changeReason.value).toBe(CHANGE_REASON.CANCELLED);
    });

    it('lê rowsAffected do SELECT, não do índice 0 do batch', async () => {
        // rowsAffected[0] num batch com seis EXEC antes é o do primeiro
        // sp_set_session_context — sempre 1 —, o que faria a guarda de status
        // parecer ter funcionado mesmo quando barrou tudo.
        const afetadas = await repository.cancelWorkSchedule('X', DISCARDABLE_STATUSES, LANCADOR);

        expect(mockCalls[0].sql).toContain('SELECT @@ROWCOUNT AS affected_rows');
        expect(afetadas).toBe(1);
    });

    it('reversão de fechamento é FINANCIAL_JOB, não ação de usuário', async () => {
        await repository.revertToPayrollQueue('202608210002091981', LANCADOR);

        const { inputs } = mockCalls[0];
        expect(inputs.from_status.value).toBe(WORK_SCHEDULE_STATUS.PAYING);
        expect(inputs.to_status.value).toBe(WORK_SCHEDULE_STATUS.AWAITING_PAYROLL);
        // Compensação automática de um fechamento que falhou — quem auditar
        // precisa distinguir isso de alguém que reverteu de propósito.
        expect(inputs.ctx_changeSource.value).toBe('FINANCIAL_JOB');
        expect(inputs.ctx_changeReason.value).toBe(CHANGE_REASON.REVERTED_TO_PAYROLL);
    });

    it('processamento 3 → 6 vai como BACKEND, com o RH que disparou', async () => {
        await repository.processWorkSchedules('A,B', LANCADOR);

        const { sql, inputs } = mockCalls[0];
        expect(inputs.ctx_changeSource.value).toBe('BACKEND');
        expect(inputs.ctx_changeReason.value).toBe(CHANGE_REASON.CALCULATION_STARTED);
        expect(sql).toContain('pcr_process_work_schedules');
        // A procedure gerencia transação própria: o contexto tem de ir por batch,
        // senão o ROLLBACK interno dela derruba a transação do Node (erro 3902).
        expect(sql).not.toContain('BEGIN TRANSACTION');
    });

    it('processo automático sem usuário ainda tem origem identificável', async () => {
        await repository.processWorkSchedules('A', null);

        const { inputs } = mockCalls[0];
        expect(inputs.ctx_globalUserId.value).toBeNull();
        expect(inputs.ctx_changeSource.value).toBe('BACKEND');
        expect(inputs.ctx_changeSource.value).not.toBe('DIRECT_DATABASE');
    });
});

describe('requisições concorrentes', () => {
    it('cada operação carrega o próprio responsável — nada é compartilhado', async () => {
        // Dois usuários no mesmo pool. O contexto vive no batch de cada um; se
        // vazasse entre eles, a transição de um seria assinada pelo outro.
        const OUTRO = { globalUserId: 500, name: 'Outro', registration: '000777', branchCode: '0301' };

        await Promise.all([
            repository.cancelWorkSchedule('A', DISCARDABLE_STATUSES, LANCADOR),
            repository.cancelWorkSchedule('B', DISCARDABLE_STATUSES, OUTRO),
        ]);

        const porJornada = Object.fromEntries(
            mockCalls.map(c => [c.inputs.cod_work_schedule.value, c.inputs.ctx_globalUserId.value])
        );

        expect(porJornada).toEqual({ A: 397, B: 500 });
    });
});
