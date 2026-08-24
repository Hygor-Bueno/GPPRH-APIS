/**
 * @fileoverview `SESSION_CONTEXT` do SQL Server — quem assina a mudança.
 *
 * O trigger `dbo.trg_cf_work_schedules_status_history` grava uma linha em
 * `cf_work_schedule_status_history` a cada INSERT em `cf_work_schedules` e a
 * cada UPDATE que realmente muda `id_status_fk`. Ele não recebe parâmetro
 * algum: descobre o responsável lendo `SESSION_CONTEXT`. Sem esse contexto, o
 * trigger cai no default e grava `change_source = 'DIRECT_DATABASE'` com
 * usuário nulo — foi o que aconteceu com todos os eventos gerados pela API
 * antes deste módulo existir.
 *
 * ─── Por que um batch único, e não uma transação ──────────────────────────────
 *
 * `SESSION_CONTEXT` pertence à CONEXÃO FÍSICA. No `mssql`, cada
 * `pool.request()` pega uma conexão qualquer do pool, então setar o contexto num
 * request e fazer o UPDATE em outro é sorteio: pode cair em conexões diferentes
 * e o trigger não vê nada.
 *
 * A saída natural seria `sql.Transaction`, que prende uma conexão — e é o que
 * `withAuditTransaction` faz. Mas ela NÃO serve para as chamadas de procedure
 * deste módulo: `prc_insert_cf_time_records` e `pcr_process_work_schedules`
 * abrem `BEGIN TRANSACTION` próprio e dão `ROLLBACK` no `CATCH` delas. Em SQL
 * Server o ROLLBACK aninhado desfaz TODAS as transações e zera `@@TRANCOUNT`;
 * o `COMMIT` do lado do Node depois estoura erro 3902 ("COMMIT TRANSACTION
 * request has no corresponding BEGIN TRANSACTION"), mascarando o erro real da
 * procedure.
 *
 * Então o mecanismo padrão aqui é `withAuditContext`: um único
 * `request.query()` com todos os comandos no MESMO batch. Um batch executa
 * inteiro numa só conexão física, por definição — não há como o pool intercalar
 * outra requisição no meio. E é o próprio T-SQL, com `BEGIN CATCH`, que garante
 * a limpeza mesmo quando a operação falha.
 *
 * ─── Por que limpar, e por que não usar @read_only ────────────────────────────
 *
 * A conexão volta ao pool com o contexto que tiver. A requisição seguinte, de
 * outro usuário, herdaria o responsável anterior e assinaria a transição dela
 * com o nome errado. `ROLLBACK` não limpa `SESSION_CONTEXT` — ele não é
 * transacional. Por isso a limpeza é explícita, e por isso as chaves NÃO podem
 * ser gravadas com `@read_only = 1`: read-only impede sobrescrever até o fim da
 * sessão, e a conexão do pool é longa.
 *
 * @module infra/sqlserver/session-context
 */

// `mssql` direto, e não o `sql` reexportado por `config/sqlserver`: aquele
// módulo cria o ConnectionPool no import, então importá-lo aqui faria este
// arquivo — que só precisa dos TIPOS de parâmetro — abrir conexão com o banco
// só por ser carregado. Também é o que permite testar este módulo sem SQL Server.
const sql = require('mssql');

/**
 * Origem da mudança — vai para `change_source`, que é NOT NULL.
 *
 * Processo automático pode ter usuário nulo, mas não origem genérica: é o que
 * permite distinguir, meses depois, uma jornada movida por engano por um humano
 * de uma movida pela rotina de cálculo.
 */
const CHANGE_SOURCE = Object.freeze({
    /** Rota chamada por usuário autenticado. */
    BACKEND: 'BACKEND',
    /** Rotina de cálculo financeiro sem usuário. */
    CALCULATION_JOB: 'CALCULATION_JOB',
    /** Rotina de pagamento sem usuário. */
    PAYMENT_JOB: 'PAYMENT_JOB',
    /** Rotina financeira sem usuário. */
    FINANCIAL_JOB: 'FINANCIAL_JOB',
    /** Manutenção interna do próprio sistema. */
    SYSTEM: 'SYSTEM',
});

const VALID_CHANGE_SOURCES = new Set(Object.values(CHANGE_SOURCE));

/** Chaves lidas pelo trigger. Os nomes são contrato com o banco. */
const CONTEXT_KEYS = Object.freeze({
    globalUserId: 'global_user_id',
    userName: 'user_name',
    userRegistration: 'user_registration',
    userBranch: 'user_branch',
    changeSource: 'change_source',
    changeReason: 'change_reason',
});

/** Prefixo dos parâmetros, para não colidir com os da query de negócio. */
const P = '@ctx_';

/**
 * Limites das colunas de destino. Truncar aqui, e não deixar o banco recusar,
 * porque um motivo de 501 caracteres derrubaria a operação inteira — perder o
 * fim do texto do motivo é preferível a não registrar a transição.
 */
const MAX_NAME = 150;
const MAX_SOURCE = 50;
const MAX_REASON = 500;

/**
 * Comandos que gravam as seis chaves.
 *
 * Setamos as seis mesmo que o trigger implantado hoje leia apenas
 * `global_user_id`, `change_source` e `change_reason`: as outras três são
 * ignoradas sem erro, e no dia em que
 * `changed_by_name_snapshot`/`_registration_snapshot`/`_branch_snapshot`
 * existirem na tabela, passam a ser preenchidas sem tocar no backend.
 *
 * @returns {string}
 */
function setContextSql() {
    return Object.entries(CONTEXT_KEYS)
        .map(([param, key]) =>
            `EXEC sys.sp_set_session_context @key = N'${key}', @value = ${P}${param};`)
        .join('\n    ');
}

/**
 * Comandos que apagam as seis chaves.
 *
 * `@value = NULL` é o que zera a chave — não existe "remover". Sem
 * `@read_only`, de propósito (ver cabeçalho).
 *
 * @returns {string}
 */
function clearContextSql() {
    return Object.values(CONTEXT_KEYS)
        .map(key => `EXEC sys.sp_set_session_context @key = N'${key}', @value = NULL;`)
        .join('\n        ');
}

/**
 * Valida a origem. Origem inválida é erro de programação, não de entrada do
 * usuário — daí o `Error` cru em vez de `AppError`: não existe requisição que
 * deva responder 4xx por isso, é para estourar em teste.
 *
 * @param {string} source
 */
function assertValidSource(source) {
    if (!VALID_CHANGE_SOURCES.has(source)) {
        throw new Error(
            `change_source inválida: '${source}'. Use CHANGE_SOURCE.* — ` +
            `origem genérica ou ambígua não é aceita na trilha de auditoria.`
        );
    }
}

/**
 * Aplica os parâmetros do contexto num `Request` do `mssql`.
 *
 * Tipos casam com as colunas de destino: matrícula e filial como VarChar para
 * preservar zeros à esquerda — Int converteria `'002351'` em `2351`.
 *
 * @param {import('mssql').Request} request
 * @param {import('../../utils/audit-actor').AuditActor} actor
 * @param {{ source: string, reason?: string|null }} change
 * @returns {import('mssql').Request} O mesmo request, para encadear.
 */
function bindContext(request, actor, { source, reason = null }) {
    assertValidSource(source);

    const truncate = (value, max) =>
        value == null ? null : String(value).slice(0, max);

    return request
        .input(`ctx_globalUserId`, sql.Int, actor?.globalUserId ?? null)
        .input(`ctx_userName`, sql.NVarChar(MAX_NAME), truncate(actor?.name, MAX_NAME))
        .input(`ctx_userRegistration`, sql.VarChar(6), actor?.registration ?? null)
        .input(`ctx_userBranch`, sql.VarChar(4), actor?.branchCode ?? null)
        .input(`ctx_changeSource`, sql.VarChar(MAX_SOURCE), truncate(source, MAX_SOURCE))
        .input(`ctx_changeReason`, sql.VarChar(MAX_REASON), truncate(reason, MAX_REASON));
}

/**
 * Envolve a operação num batch que seta o contexto antes e o limpa depois,
 * inclusive quando a operação falha.
 *
 * O `THROW;` do `CATCH` repropaga o erro original preservando número, mensagem
 * e severidade — é o que mantém o `sqlserver-error.translator` funcionando, já
 * que ele casa pelo texto das mensagens de `RAISERROR` das procedures.
 *
 * `SELECT @@ROWCOUNT` é opcional e existe porque num batch de vários comandos o
 * `result.rowsAffected[0]` do `mssql` deixa de ser o da operação de negócio —
 * passa a ser o do primeiro comando do batch. Quem precisa da contagem lê
 * `result.recordset[0].affected_rows`.
 *
 * @param {string} operationSql - SQL da operação (UPDATE, EXEC, ...).
 * @param {{ captureRowCount?: boolean }} [options]
 * @returns {string} Batch completo.
 */
function withAuditContext(operationSql, { captureRowCount = false } = {}) {
    const rowCount = captureRowCount
        ? '\n        SELECT @@ROWCOUNT AS affected_rows;'
        : '';

    return `
    ${setContextSql()}

    BEGIN TRY
        ${operationSql.trim()}${rowCount}
    END TRY
    BEGIN CATCH
        ${clearContextSql()}

        THROW;
    END CATCH

    ${clearContextSql()}
    `;
}

/**
 * Variante com transação, para quando várias operações precisam ser atômicas
 * entre si E compartilhar o contexto.
 *
 * ⚠️ NÃO use para chamar `prc_insert_cf_time_records` nem
 * `pcr_process_work_schedules`: essas procedures gerenciam transação própria e
 * o ROLLBACK interno delas derruba esta (ver cabeçalho). Para procedures, use
 * `withAuditContext`.
 *
 * A limpeza acontece ANTES do `commit`/`rollback`, e não num `finally` depois:
 * o `mssql` devolve a conexão ao pool ao encerrar a transação, e a partir daí
 * não há mais como alcançar aquela conexão física para limpá-la. Limpar dentro
 * da transação é seguro justamente porque `SESSION_CONTEXT` não é transacional —
 * o `ROLLBACK` não ressuscita os valores.
 *
 * @param {import('mssql').ConnectionPool} pool
 * @param {import('../../utils/audit-actor').AuditActor} actor
 * @param {{ source: string, reason?: string|null }} change
 * @param {(request: () => import('mssql').Request) => Promise<any>} work
 *   Recebe uma fábrica de `Request` já presos à transação.
 * @returns {Promise<any>}
 */
async function withAuditTransaction(pool, actor, change, work) {
    assertValidSource(change.source);

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    const newRequest = () => new sql.Request(transaction);

    /** Melhor-esforço: falha ao limpar não deve substituir o erro da operação. */
    const clear = async () => {
        try {
            await newRequest().query(clearContextSql());
        } catch { /* conexão já derrubada — nada a limpar */ }
    };

    try {
        await bindContext(newRequest(), actor, change).query(setContextSql());

        const result = await work(newRequest);

        await clear();
        await transaction.commit();
        return result;
    } catch (error) {
        await clear();

        // `_aborted` evita o "no transaction is begun" quando algo já desfez a
        // transação — um segundo rollback estoura por cima do erro original e
        // esconde a causa. Mesmo cuidado de `sqlserver-meal-enroll.repository`.
        if (!transaction._aborted && transaction._acquiredConnection) {
            try { await transaction.rollback(); } catch { /* já desfeita */ }
        }
        throw error;
    }
}

module.exports = {
    CHANGE_SOURCE,
    CONTEXT_KEYS,
    bindContext,
    withAuditContext,
    withAuditTransaction,
    setContextSql,
    clearContextSql,
    assertValidSource,
};
