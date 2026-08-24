const {
    CHANGE_SOURCE,
    CONTEXT_KEYS,
    bindContext,
    withAuditContext,
    withAuditTransaction,
    setContextSql,
    clearContextSql,
    assertValidSource,
} = require('../session-context');

/** Request de mentira: registra os `.input()` e permite encadear. */
function fakeRequest() {
    const inputs = {};
    const request = {
        inputs,
        input(name, type, value) {
            inputs[name] = { type, value };
            return request;
        },
        query: jest.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
    };
    return request;
}

const ACTOR = Object.freeze({
    globalUserId: 397,
    name: 'BERENILDO NOBERTO LINO',
    registration: '002351',
    branchCode: '0202',
});

describe('setContextSql / clearContextSql', () => {
    const ALL_KEYS = Object.values(CONTEXT_KEYS);

    it('grava as seis chaves que o trigger pode ler', () => {
        const sql = setContextSql();
        for (const key of ALL_KEYS) {
            expect(sql).toContain(`@key = N'${key}'`);
        }
        expect(ALL_KEYS).toHaveLength(6);
    });

    it('limpa as seis chaves com NULL', () => {
        const sql = clearContextSql();
        for (const key of ALL_KEYS) {
            expect(sql).toContain(`@key = N'${key}', @value = NULL`);
        }
    });

    it('nunca usa @read_only — a conexão do pool é reutilizada', () => {
        // Com @read_only = 1 o valor não pode ser sobrescrito até o fim da
        // sessão, e a sessão de uma conexão de pool dura horas: o próximo
        // usuário herdaria este responsável para sempre.
        expect(setContextSql()).not.toMatch(/read_only/i);
        expect(clearContextSql()).not.toMatch(/read_only/i);
    });

    it('usa parâmetros, nunca valor interpolado no texto', () => {
        expect(setContextSql()).toContain('@value = @ctx_');
        expect(setContextSql()).not.toContain(ACTOR.registration);
    });
});

describe('bindContext', () => {
    it('manda matrícula e filial como VarChar para preservar os zeros', () => {
        const request = bindContext(fakeRequest(), ACTOR, {
            source: CHANGE_SOURCE.BACKEND,
            reason: 'Compra de folga aprovada pelo gerente',
        });

        expect(request.inputs.ctx_userRegistration.value).toBe('002351');
        expect(request.inputs.ctx_userBranch.value).toBe('0202');
        // VarChar(6) / VarChar(4) — Int converteria em 2351 e 202.
        expect(request.inputs.ctx_userRegistration.type.type.declaration).toBe('varchar');
        expect(request.inputs.ctx_userRegistration.type.length).toBe(6);
        expect(request.inputs.ctx_userBranch.type.type.declaration).toBe('varchar');
        expect(request.inputs.ctx_userBranch.type.length).toBe(4);
        expect(request.inputs.ctx_globalUserId.value).toBe(397);
    });

    it('aceita ator de processo automático (usuário nulo)', () => {
        const request = bindContext(fakeRequest(), null, {
            source: CHANGE_SOURCE.CALCULATION_JOB,
        });

        expect(request.inputs.ctx_globalUserId.value).toBeNull();
        expect(request.inputs.ctx_userName.value).toBeNull();
        expect(request.inputs.ctx_changeSource.value).toBe('CALCULATION_JOB');
        expect(request.inputs.ctx_changeReason.value).toBeNull();
    });

    it('recusa origem genérica ou desconhecida', () => {
        // "Processos automáticos podem ter usuário NULL, mas não podem ficar
        // com origem genérica ou ambígua."
        expect(() => bindContext(fakeRequest(), ACTOR, { source: 'JOB' }))
            .toThrow(/change_source inválida/);
        expect(() => bindContext(fakeRequest(), ACTOR, { source: '' }))
            .toThrow(/change_source inválida/);
        expect(() => assertValidSource(CHANGE_SOURCE.PAYMENT_JOB)).not.toThrow();
    });

    it('trunca o motivo em 500 para não derrubar a operação inteira', () => {
        const request = bindContext(fakeRequest(), ACTOR, {
            source: CHANGE_SOURCE.BACKEND,
            reason: 'x'.repeat(600),
        });

        expect(request.inputs.ctx_changeReason.value).toHaveLength(500);
    });

    it('trunca o nome em 150', () => {
        const request = bindContext(fakeRequest(), { ...ACTOR, name: 'y'.repeat(200) }, {
            source: CHANGE_SOURCE.BACKEND,
        });

        expect(request.inputs.ctx_userName.value).toHaveLength(150);
    });
});

describe('withAuditContext', () => {
    const OPERATION = 'UPDATE GIPP.dbo.cf_work_schedules SET id_status_fk = @to_status;';

    it('seta o contexto ANTES da operação, no mesmo batch', () => {
        const batch = withAuditContext(OPERATION);

        const posContexto = batch.indexOf("@key = N'global_user_id'");
        const posOperacao = batch.indexOf('UPDATE GIPP.dbo.cf_work_schedules');

        expect(posContexto).toBeGreaterThan(-1);
        expect(posOperacao).toBeGreaterThan(posContexto);
    });

    it('limpa o contexto também no caminho de erro', () => {
        const batch = withAuditContext(OPERATION);
        const catchBlock = batch.slice(batch.indexOf('BEGIN CATCH'));

        expect(catchBlock).toContain("@key = N'global_user_id', @value = NULL");
        // Sem o THROW, a operação falharia em silêncio e a rota responderia 200.
        expect(catchBlock).toContain('THROW;');
    });

    it('limpa o contexto no caminho de sucesso', () => {
        const batch = withAuditContext(OPERATION);
        const depoisDoCatch = batch.slice(batch.indexOf('END CATCH'));

        expect(depoisDoCatch).toContain("@key = N'change_source', @value = NULL");
    });

    it('expõe a contagem de linhas por SELECT, não por rowsAffected', () => {
        // Num batch com seis EXEC antes, rowsAffected[0] deixa de ser o do
        // UPDATE — passa a ser o do primeiro sp_set_session_context.
        expect(withAuditContext(OPERATION, { captureRowCount: true }))
            .toContain('SELECT @@ROWCOUNT AS affected_rows;');
        expect(withAuditContext(OPERATION)).not.toContain('@@ROWCOUNT');
    });

    it('mantém a operação intacta — inclusive EXEC de procedure', () => {
        const exec = 'EXEC GIPP.dbo.pcr_process_work_schedules @CodWorkSchedules = @CodWorkSchedules;';
        expect(withAuditContext(exec)).toContain(exec);
    });
});

describe('withAuditTransaction', () => {
    /** Pool/transação de mentira, registrando a ordem dos comandos. */
    function fakeSql() {
        const ordem = [];
        const transaction = {
            _aborted: false,
            _acquiredConnection: true,
            begin: jest.fn(async () => { ordem.push('begin'); }),
            commit: jest.fn(async () => { ordem.push('commit'); }),
            rollback: jest.fn(async () => { ordem.push('rollback'); }),
        };
        return { ordem, transaction };
    }

    let mssql;

    beforeEach(() => {
        jest.resetModules();
        mssql = require('mssql');
    });

    it('limpa o contexto ANTES do commit', async () => {
        const { ordem, transaction } = fakeSql();

        jest.spyOn(mssql, 'Transaction').mockImplementation(() => transaction);
        jest.spyOn(mssql, 'Request').mockImplementation(() => {
            const request = fakeRequest();
            request.query = jest.fn(async (sql) => {
                ordem.push(/= NULL/.test(sql) ? 'clear' : 'set');
                return { recordset: [] };
            });
            return request;
        });

        const { withAuditTransaction: run } = require('../session-context');
        await run({}, ACTOR, { source: CHANGE_SOURCE.BACKEND }, async () => {
            ordem.push('work');
            return 'feito';
        });

        // Depois do commit o mssql devolve a conexão ao pool: limpar ali seria
        // limpar a conexão errada — ou nenhuma.
        expect(ordem).toEqual(['begin', 'set', 'work', 'clear', 'commit']);
    });

    it('limpa o contexto e desfaz quando a operação falha', async () => {
        const { ordem, transaction } = fakeSql();

        jest.spyOn(mssql, 'Transaction').mockImplementation(() => transaction);
        jest.spyOn(mssql, 'Request').mockImplementation(() => {
            const request = fakeRequest();
            request.query = jest.fn(async (sql) => {
                ordem.push(/= NULL/.test(sql) ? 'clear' : 'set');
                return { recordset: [] };
            });
            return request;
        });

        const { withAuditTransaction: run } = require('../session-context');

        await expect(
            run({}, ACTOR, { source: CHANGE_SOURCE.BACKEND }, async () => {
                throw new Error('constraint violada');
            })
        ).rejects.toThrow('constraint violada');

        // ROLLBACK não desfaz SESSION_CONTEXT: sem o clear, a conexão voltaria
        // suja ao pool e a próxima requisição herdaria este responsável.
        expect(ordem).toEqual(['begin', 'set', 'clear', 'rollback']);
    });

    it('recusa origem inválida antes de abrir transação', async () => {
        const { transaction } = fakeSql();
        jest.spyOn(mssql, 'Transaction').mockImplementation(() => transaction);

        const { withAuditTransaction: run } = require('../session-context');

        await expect(run({}, ACTOR, { source: 'QUALQUER' }, async () => {}))
            .rejects.toThrow(/change_source inválida/);
        expect(transaction.begin).not.toHaveBeenCalled();
    });
});
