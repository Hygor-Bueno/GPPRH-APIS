const { translateSqlServerError } = require('../sqlserver-error.translator');

describe('translateSqlServerError', () => {
    it.each([
        ['jornada já aberta', 'There is already an open record, please close it before opening a new record.', 409, 'SCHEDULE_ALREADY_OPEN'],
        ['entrada duplicada', 'There is already a registered (not cancelled) entry for this contributor on this date.', 409, 'ENTRY_ALREADY_REGISTERED'],
        ['saída duplicada', 'There is already a registered departure (not cancelled) for this employee on this date.', 409, 'EXIT_ALREADY_REGISTERED'],
        ['saída sem entrada', 'There is no valid (uncancelled) entry for this employee. It is not possible to record an exit.', 409, 'MISSING_ENTRY'],
        ['data futura', 'It is not allowed to register a time record with a future date.', 400, 'FUTURE_DATE'],
        ['jornada inexistente', 'Work schedule code not found.', 404, 'SCHEDULE_NOT_FOUND'],
    ])('deve traduzir %s para 4xx em português', (_label, raw, status, code) => {
        const result = translateSqlServerError(new Error(raw));

        expect(result).toMatchObject({ status, code });
        // Nenhuma mensagem devolvida ao usuário pode continuar em inglês.
        expect(result.message).not.toMatch(/There is|not allowed|not found/);
    });

    it('deve reconhecer a mensagem com sufixo variável', () => {
        // Esta procedure concatena o código da jornada no fim da mensagem.
        const raw = 'There is already an active appointment for this employee on this date.: 202608080002091981';

        expect(translateSqlServerError(new Error(raw))).toMatchObject({
            status: 409,
            code: 'SCHEDULE_ALREADY_EXISTS',
        });
    });

    it('deve ler a mensagem de dentro de originalError, como o driver mssql entrega', () => {
        const driverError = new Error('RequestError');
        driverError.originalError = { info: { message: 'Work schedule code not found.' } };

        expect(translateSqlServerError(driverError)).toMatchObject({ status: 404 });
    });

    it('deve devolver null para falha técnica de verdade', () => {
        // Sem correspondência é erro de infraestrutura: continua 500.
        expect(translateSqlServerError(new Error('Timeout: Request failed to complete in 30000ms'))).toBeNull();
        expect(translateSqlServerError(new Error('ECONNREFUSED'))).toBeNull();
    });

    it('deve tolerar erro sem mensagem', () => {
        expect(translateSqlServerError({})).toBeNull();
        expect(translateSqlServerError(null)).toBeNull();
    });
});
