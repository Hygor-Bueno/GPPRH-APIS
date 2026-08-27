/**
 * @fileoverview Tradução dos erros de regra de negócio vindos do SQL Server.
 *
 * As stored procedures do GIPP validam regras com `RAISERROR` e mensagens em
 * inglês. Do lado do Node esses erros chegam como `RequestError` do driver
 * `mssql` — não são `AppError`, então caem no fallback do repositório e viram
 * **500 com o texto cru do banco**. Quem esqueceu de bater a saída recebia um
 * "erro interno do servidor" em inglês em vez de saber o que fazer.
 *
 * Este módulo reconhece essas mensagens e devolve status HTTP e texto em
 * português. Traduzir aqui, e não nas procedures, evita `ALTER` em objetos de
 * produção que outros sistemas também chamam.
 *
 * O casamento é por trecho estável da mensagem, e não pelo texto inteiro:
 * algumas trazem sufixo variável (o código da jornada, por exemplo).
 *
 * @module modules/gipp/infrastructure/sqlserver-error.translator
 */

/**
 * @type {Array<{match: string, status: number, code: string, message: string}>}
 */
const BUSINESS_RULES = [
    {
        match: 'There is already an active appointment for this employee on this date',
        status: 409,
        code: 'SCHEDULE_ALREADY_EXISTS',
        message: 'Já existe uma jornada ativa para este colaborador nesta data.',
    },
    {
        match: 'There is already an open record, please close it before opening a new record',
        status: 409,
        code: 'SCHEDULE_ALREADY_OPEN',
        message: 'Este colaborador já tem uma jornada em aberto. Registre a saída antes de iniciar outra.',
    },
    {
        match: 'There is already a registered (not cancelled) entry for this contributor on this date',
        status: 409,
        code: 'ENTRY_ALREADY_REGISTERED',
        message: 'Já existe uma entrada registrada para este colaborador nesta data.',
    },
    {
        match: 'There is already a registered departure (not cancelled) for this employee on this date',
        status: 409,
        code: 'EXIT_ALREADY_REGISTERED',
        message: 'Já existe uma saída registrada para este colaborador nesta data.',
    },
    {
        match: 'There is no valid (uncancelled) entry for this employee',
        status: 409,
        code: 'MISSING_ENTRY',
        message: 'Não há entrada válida para este colaborador. Registre a entrada antes da saída.',
    },
    {
        match: 'It is not allowed to register a time record with a future date',
        status: 400,
        code: 'FUTURE_DATE',
        message: 'Não é possível registrar uma marcação com data futura.',
    },
    {
        match: 'Work schedule code not found',
        status: 404,
        code: 'SCHEDULE_NOT_FOUND',
        message: 'Jornada não encontrada.',
    },
];

/**
 * Procura uma regra de negócio conhecida na mensagem do erro.
 *
 * @param {Error} error - Erro cru vindo do driver.
 * @returns {?{status: number, code: string, message: string}} `null` quando a
 *   mensagem não corresponde a nenhuma regra — aí é falha técnica de verdade.
 */
function translateSqlServerError(error) {
    const raw = error?.originalError?.info?.message || error?.message;
    if (typeof raw !== 'string') return null;

    const rule = BUSINESS_RULES.find(r => raw.includes(r.match));
    if (!rule) return null;

    return { status: rule.status, code: rule.code, message: rule.message };
}

module.exports = { translateSqlServerError, BUSINESS_RULES };
