/**
 * @fileoverview Testes do código de pareamento de 8 dígitos.
 *
 * O foco é o que protege um código curto: formato (incluindo zeros à esquerda),
 * uso único e recusa uniforme. O helper de banco é trocado por mock — nenhum
 * teste toca o MySQL.
 */

jest.mock('../miepp-mysql.helper', () => ({
    execute: jest.fn(async () => ({ affectedRows: 1, insertId: 1 })),
    transaction: jest.fn(),
    query: jest.fn(),
}));

const helper = require('../miepp-mysql.helper');

const { MieppPairingCodeService } = require('../miepp-pairing-code.service');
const {
    SQL_INSERT_PAIRING_CODE,
    SQL_INVALIDATE_PLAYER_CODES,
} = require('../../../repositories/mysql/miepp-pairing-code.queries');

const makeService = () => new MieppPairingCodeService({ ttlMinutes: 10, codeLength: 8 });

beforeEach(() => jest.clearAllMocks());

describe('emissão', () => {
    it('gera código de exatamente 8 dígitos', async () => {
        const { code } = await makeService().issue(1, 42);
        expect(code).toMatch(/^[0-9]{8}$/);
    });

    it('invalida os códigos anteriores do player ANTES de gravar o novo', async () => {
        // Dois códigos vivos para a mesma tela dobrariam a superfície de
        // adivinhação sem servir a ninguém.
        await makeService().issue(7, 42);

        const chamadas = helper.execute.mock.calls.map(([sql]) => sql);
        expect(chamadas[0]).toBe(SQL_INVALIDATE_PLAYER_CODES);
        expect(chamadas[1]).toBe(SQL_INSERT_PAIRING_CODE);
    });

    it('grava quem pediu, para a trilha', async () => {
        await makeService().issue(7, 42);
        const [, params] = helper.execute.mock.calls[1];
        expect(params[0]).toBe(7);          // player_id
        expect(params[3]).toBe(42);         // created_by
    });

    it('devolve o vencimento coerente com o TTL', async () => {
        const antes = Date.now();
        const result = await makeService().issue(1);

        expect(result.expires_in_seconds).toBe(600);
        const expira = new Date(result.expires_at).getTime();
        expect(expira).toBeGreaterThanOrEqual(antes + 600_000 - 2000);
        expect(expira).toBeLessThanOrEqual(Date.now() + 600_000 + 2000);
    });

    it('preserva zeros à esquerda ao longo de muitas emissões', async () => {
        // Sortear como número e formatar sem padding descartaria ~10% do espaço
        // (tudo que começa com zero) sem ninguém perceber.
        const service = makeService();
        const codigos = [];
        for (let i = 0; i < 300; i += 1) {
            codigos.push((await service.issue(1)).code);
        }

        expect(codigos.every((c) => /^[0-9]{8}$/.test(c))).toBe(true);
        expect(new Set(codigos).size).toBeGreaterThan(290); // sem repetição sistemática
    });

    it('tenta outro número quando colide com um código vivo', async () => {
        const duplicado = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        helper.execute
            .mockResolvedValueOnce({ affectedRows: 0 })   // invalidação
            .mockRejectedValueOnce(duplicado)             // 1ª tentativa colide
            .mockResolvedValueOnce({ insertId: 2 });      // 2ª passa

        const { code } = await makeService().issue(1);
        expect(code).toMatch(/^[0-9]{8}$/);
        expect(helper.execute).toHaveBeenCalledTimes(3);
    });
});

describe('verificação', () => {
    /** Simula a transação entregando as linhas que o SELECT devolveria. */
    function mockTransaction({ rows, consumed = 1 }) {
        helper.transaction.mockImplementation(async (run) => run({
            query: jest.fn()
                .mockResolvedValueOnce([rows])
                .mockResolvedValueOnce([{ affectedRows: consumed }]),
        }));
    }

    it('devolve o player e consome o código', async () => {
        mockTransaction({ rows: [{ id: 9, player_id: 3 }] });
        await expect(makeService().verify('12345678')).resolves.toBe(3);
    });

    it('aceita código com zeros à esquerda', async () => {
        mockTransaction({ rows: [{ id: 9, player_id: 3 }] });
        await expect(makeService().verify('00000042')).resolves.toBe(3);
    });

    it.each([
        ['inexistente ou expirado', '12345678', []],
    ])('recusa %s com 401', async (_nome, code, rows) => {
        mockTransaction({ rows });
        await expect(makeService().verify(code)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('recusa quando outra requisição consumiu primeiro', async () => {
        // Corrida: o SELECT viu a linha, mas o UPDATE não afetou nada. Parear
        // duas vezes com o mesmo código daria dois tokens para a mesma tela.
        mockTransaction({ rows: [{ id: 9, player_id: 3 }], consumed: 0 });
        await expect(makeService().verify('12345678')).rejects.toMatchObject({ statusCode: 401 });
    });

    it.each(['1234567', '123456789', 'abcdefgh', '1234 678', '', null, undefined, 12345678])(
        'recusa formato inválido sem ir ao banco: %p',
        async (code) => {
            await expect(makeService().verify(code)).rejects.toMatchObject({ statusCode: 401 });
            expect(helper.transaction).not.toHaveBeenCalled();
        }
    );

    it('a mensagem de recusa é sempre a mesma', async () => {
        // Distinguir "não existe" de "expirado" de "já usado" só ajudaria quem
        // está adivinhando.
        mockTransaction({ rows: [] });
        const porFormato = await makeService().verify('abcdefgh').catch((e) => e.message);
        const porBusca = await makeService().verify('12345678').catch((e) => e.message);
        expect(porFormato).toBe(porBusca);
    });
});
