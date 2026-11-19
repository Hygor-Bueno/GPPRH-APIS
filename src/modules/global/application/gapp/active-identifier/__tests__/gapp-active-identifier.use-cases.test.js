const { GappActiveIdentifierUseCases, normalizeIdentifier } = require('../gapp-active-identifier.use-cases');

const CURRENT_USER = { id: 1 };
const GAPP_USER = { user_id: 10, work_group_fk: 5 };
const row = (id, overrides = {}) => ({ identifier_id: id, active_id_fk: 120, identifier_type: 'PATRIMONIO', identifier_value: `P${id}`, is_primary: 0, ...overrides });

function makeDeps(repository = {}, gappUser = GAPP_USER) {
    const repo = {
        activeInGroup: jest.fn().mockResolvedValue(true),
        listByActive: jest.fn().mockResolvedValue([]),
        findById: jest.fn().mockResolvedValue(row(1)),
        findByValue: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockResolvedValue({ insertId: 7 }),
        setPrimary: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue({ deleted: 1 }),
        ...repository,
    };
    const userRepository = { findAuthByAccessCode: jest.fn().mockResolvedValue(gappUser) };
    return { repo, useCases: new GappActiveIdentifierUseCases({ repository: repo, userRepository }) };
}

describe('normalizeIdentifier', () => {
    test('aceita só PATRIMONIO e SERIAL, com valor sem espaços', () => {
        expect(normalizeIdentifier({ identifier_type: 'IMEI', identifier_value: '1' }).error).toBeDefined();
        expect(normalizeIdentifier({ identifier_type: 'SERIAL', identifier_value: '  ' }).error).toMatch(/série/);
        expect(normalizeIdentifier({ identifier_type: 'PATRIMONIO', identifier_value: ' 00123 ', is_primary: 1 }).value)
            .toEqual({ type: 'PATRIMONIO', value: '00123', isPrimary: true });
    });
});

describe('GappActiveIdentifierUseCases', () => {
    test('ativo de outro grupo → 404 e não consulta a lista', async () => {
        const { useCases, repo } = makeDeps({ activeInGroup: jest.fn().mockResolvedValue(false) });
        await expect(useCases.list(120, CURRENT_USER)).rejects.toMatchObject({ statusCode: 404 });
        expect(repo.activeInGroup).toHaveBeenCalledWith(120, 5);
        expect(repo.listByActive).not.toHaveBeenCalled();
    });

    test('usuário fora do GAPP → 404', async () => {
        const { useCases } = makeDeps({}, null);
        await expect(useCases.list(120, CURRENT_USER)).rejects.toMatchObject({ statusCode: 404 });
    });

    describe('create', () => {
        test('primeiro identificador do ativo já nasce principal', async () => {
            const { useCases, repo } = makeDeps();
            await useCases.create(120, { identifier_type: 'PATRIMONIO', identifier_value: ' P1 ' }, CURRENT_USER);
            expect(repo.insert).toHaveBeenCalledWith(120, 'PATRIMONIO', 'P1');
            expect(repo.setPrimary).toHaveBeenCalledWith(7, 120);
        });

        test('com outros já cadastrados, só vira principal se pedir', async () => {
            const { useCases, repo } = makeDeps({ listByActive: jest.fn().mockResolvedValue([row(1, { is_primary: 1 })]) });
            await useCases.create(120, { identifier_type: 'SERIAL', identifier_value: 'SN1' }, CURRENT_USER);
            expect(repo.setPrimary).not.toHaveBeenCalled();
            await useCases.create(120, { identifier_type: 'SERIAL', identifier_value: 'SN2', is_primary: 1 }, CURRENT_USER);
            expect(repo.setPrimary).toHaveBeenCalledWith(7, 120);
        });

        test('identificador de outro ativo → 409 e não grava', async () => {
            const { useCases, repo } = makeDeps({ findByValue: jest.fn().mockResolvedValue({ identifier_id: 3, active_id_fk: 300 }) });
            await expect(useCases.create(120, { identifier_type: 'PATRIMONIO', identifier_value: 'P1' }, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 409, code: 'GAPP_ACTIVE_IDENTIFIER_IN_USE', details: { active_id: 300 } });
            expect(repo.insert).not.toHaveBeenCalled();
        });

        test('dado inválido → 400', async () => {
            const { useCases } = makeDeps();
            await expect(useCases.create(120, { identifier_type: 'PATRIMONIO', identifier_value: '' }, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 400 });
        });
    });

    test('setPrimary de identificador de outro ativo → 404', async () => {
        const { useCases, repo } = makeDeps({ findById: jest.fn().mockResolvedValue(null) });
        await expect(useCases.setPrimary(120, 9, CURRENT_USER)).rejects.toMatchObject({ statusCode: 404 });
        expect(repo.setPrimary).not.toHaveBeenCalled();
    });

    describe('cadastro junto com o ativo novo', () => {
        const list = [
            { identifier_type: 'SERIAL', identifier_value: ' SN1 ' },
            { identifier_type: 'PATRIMONIO', identifier_value: 'P9', is_primary: 1 },
        ];

        test('valida a lista inteira antes (formato, repetido na lista e dono)', async () => {
            const { useCases, repo } = makeDeps();
            await expect(useCases.prepareForNewAsset('x')).rejects.toMatchObject({ statusCode: 400 });
            await expect(useCases.prepareForNewAsset([list[0], { identifier_type: 'SERIAL', identifier_value: 'sn1' }]))
                .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/repetido/) });
            expect(await useCases.prepareForNewAsset(undefined)).toEqual([]);
            expect(await useCases.prepareForNewAsset(list)).toEqual([
                { type: 'SERIAL', value: 'SN1', isPrimary: false },
                { type: 'PATRIMONIO', value: 'P9', isPrimary: true },
            ]);
            expect(repo.findByValue).toHaveBeenCalledWith('PATRIMONIO', 'P9');
        });

        test('número já usado em outro ativo → 409 antes de qualquer gravação', async () => {
            const { useCases, repo } = makeDeps({ findByValue: jest.fn().mockResolvedValue({ identifier_id: 3, active_id_fk: 300 }) });
            await expect(useCases.prepareForNewAsset(list)).rejects.toMatchObject({ statusCode: 409, details: { active_id: 300 } });
            expect(repo.insert).not.toHaveBeenCalled();
        });

        test('grava todos e marca o principal pedido (ou o primeiro)', async () => {
            const insert = jest.fn().mockResolvedValueOnce({ insertId: 11 }).mockResolvedValueOnce({ insertId: 12 });
            const { useCases, repo } = makeDeps({ insert });
            await useCases.addToNewAsset(120, await useCases.prepareForNewAsset(list));
            expect(insert).toHaveBeenNthCalledWith(1, 120, 'SERIAL', 'SN1');
            expect(repo.setPrimary).toHaveBeenCalledWith(12, 120);
        });
    });

    describe('remove', () => {
        test('removendo o principal, o mais antigo que sobrou assume', async () => {
            const { useCases, repo } = makeDeps({ listByActive: jest.fn().mockResolvedValue([row(2), row(3)]) });
            await useCases.remove(120, 1, CURRENT_USER);
            expect(repo.delete).toHaveBeenCalledWith(1, 120);
            expect(repo.setPrimary).toHaveBeenCalledWith(2, 120);
        });

        test('sem linha apagada → 404', async () => {
            const { useCases } = makeDeps({ delete: jest.fn().mockResolvedValue({ deleted: 0 }) });
            await expect(useCases.remove(120, 1, CURRENT_USER)).rejects.toMatchObject({ statusCode: 404 });
        });
    });
});
