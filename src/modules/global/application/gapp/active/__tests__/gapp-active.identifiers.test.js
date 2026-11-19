const { GappActiveUseCases } = require('../gapp-active.use-cases');

const CURRENT_USER = { id: 1 };
const IDENTIFIERS = [{ identifier_type: 'PATRIMONIO', identifier_value: 'P1' }];
const PREPARED = [{ type: 'PATRIMONIO', value: 'P1', isPrimary: false }];

function makeDeps(identifierOverrides = {}) {
    const repository = {
        findById: jest.fn().mockResolvedValue(null),
        saveActive: jest.fn().mockResolvedValue({ id: 120 }),
    };
    const identifierUseCases = {
        prepareForNewAsset: jest.fn().mockResolvedValue(PREPARED),
        addToNewAsset: jest.fn().mockResolvedValue(undefined),
        ...identifierOverrides,
    };
    const userRepository = { findAuthByAccessCode: jest.fn().mockResolvedValue({ user_id: 10, work_group_fk: 5 }) };
    const useCases = new GappActiveUseCases({ repository, userRepository, insuranceRepository: {}, identifierUseCases });
    return { useCases, repository, identifierUseCases };
}

describe('GappActiveUseCases — identificadores no cadastro do ativo', () => {
    test('valida antes, grava o ativo sem a lista e depois os identificadores', async () => {
        const { useCases, repository, identifierUseCases } = makeDeps();
        const result = await useCases.save({ status_active: 1, is_vehicle: 0, identifiers: IDENTIFIERS }, CURRENT_USER);
        expect(identifierUseCases.prepareForNewAsset).toHaveBeenCalledWith(IDENTIFIERS);
        expect(repository.saveActive.mock.calls[0][0]).not.toHaveProperty('identifiers');
        expect(identifierUseCases.addToNewAsset).toHaveBeenCalledWith(120, PREPARED);
        expect(result).toEqual({ id: 120 });
    });

    test('recusa na validação não cria o ativo', async () => {
        const { useCases, repository } = makeDeps({ prepareForNewAsset: jest.fn().mockRejectedValue(Object.assign(new Error('em uso'), { statusCode: 409 })) });
        await expect(useCases.save({ status_active: 1, is_vehicle: 0, identifiers: IDENTIFIERS }, CURRENT_USER)).rejects.toMatchObject({ statusCode: 409 });
        expect(repository.saveActive).not.toHaveBeenCalled();
    });

    test('falha ao gravar depois do ativo criado vira aviso, não erro', async () => {
        const { useCases } = makeDeps({ addToNewAsset: jest.fn().mockRejectedValue(new Error('duplicado')) });
        const result = await useCases.save({ status_active: 1, is_vehicle: 0, identifiers: IDENTIFIERS }, CURRENT_USER);
        expect(result).toMatchObject({ id: 120, identifiers_warning: expect.stringMatching(/Ativo #120 registrado/) });
    });

    test('na alteração (com active_id) a lista é ignorada', async () => {
        const { useCases, repository, identifierUseCases } = makeDeps();
        repository.findById.mockResolvedValue({ active_id: 120, status_active: 1 });
        await useCases.save({ active_id: 120, status_active: 1, is_vehicle: 0, identifiers: IDENTIFIERS }, CURRENT_USER);
        expect(identifierUseCases.prepareForNewAsset).not.toHaveBeenCalled();
        expect(identifierUseCases.addToNewAsset).not.toHaveBeenCalled();
    });
});
