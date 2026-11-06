const { GappAssetTermUseCases } = require('../gapp-asset-term.use-cases');

const TERM = {
    asset_term_id: 7, reponsible_name: 'Fulano', created_by: 1, active_id_fk: 42,
    file_id_fk: 100, file_name: 'termo.pdf',
};
const FILE = { originalname: 'novo.pdf', buffer: Buffer.from('x') };

function makeDeps(overrides = {}) {
    const repository = {
        list: jest.fn().mockResolvedValue({ items: [TERM], total: 1, page: 1, limit: 20 }),
        findById: jest.fn().mockResolvedValue(TERM),
        activeExists: jest.fn().mockResolvedValue(true),
        countFileReferences: jest.fn().mockResolvedValue(0),
        insert: jest.fn().mockResolvedValue({ insertId: 7 }),
        update: jest.fn().mockResolvedValue({ updated: 1 }),
        delete: jest.fn().mockResolvedValue({ deleted: 1 }),
        ...overrides.repository,
    };
    const storage = {
        save: jest.fn().mockResolvedValue({ fileId: 200, fileName: 'novo.pdf' }),
        remove: jest.fn().mockResolvedValue(),
        ...overrides.storage,
    };
    return { repository, storage, useCases: new GappAssetTermUseCases({ repository, storage }) };
}

describe('GappAssetTermUseCases', () => {
    beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => { }));
    afterEach(() => jest.restoreAllMocks());

    test('lista repassando os filtros', async () => {
        const { useCases, repository } = makeDeps();
        await useCases.listAssetTerms({ reponsible_name: 'Ful', page: 2 });
        expect(repository.list).toHaveBeenCalledWith({ reponsible_name: 'Ful', page: 2 });
    });

    test('busca por id inexistente retorna 404', async () => {
        const { useCases } = makeDeps({ repository: { findById: jest.fn().mockResolvedValue(null) } });
        await expect(useCases.getAssetTermById(99)).rejects.toMatchObject({ statusCode: 404 });
    });

    describe('createAssetTerm', () => {
        test('grava o arquivo e o termo com created_by do usuário', async () => {
            const { useCases, repository, storage } = makeDeps();
            await useCases.createAssetTerm({ reponsible_name: 'Fulano', active_id_fk: 42 }, FILE, 1);
            expect(storage.save).toHaveBeenCalledWith(FILE, 1);
            expect(repository.insert).toHaveBeenCalledWith({
                reponsible_name: 'Fulano', created_by: 1, active_id_fk: 42, file_id_fk: 200, file_name: 'novo.pdf',
            });
        });

        test('sem arquivo: 400 e nada é gravado', async () => {
            const { useCases, repository, storage } = makeDeps();
            await expect(useCases.createAssetTerm({ reponsible_name: 'F', active_id_fk: 42 }, undefined, 1))
                .rejects.toMatchObject({ statusCode: 400 });
            expect(storage.save).not.toHaveBeenCalled();
            expect(repository.insert).not.toHaveBeenCalled();
        });

        test('ativo inexistente: 404 antes de gravar o arquivo', async () => {
            const { useCases, storage } = makeDeps({ repository: { activeExists: jest.fn().mockResolvedValue(false) } });
            await expect(useCases.createAssetTerm({ reponsible_name: 'F', active_id_fk: 1 }, FILE, 1))
                .rejects.toMatchObject({ statusCode: 404 });
            expect(storage.save).not.toHaveBeenCalled();
        });
    });

    describe('updateAssetTerm', () => {
        test('sem arquivo novo mantém o arquivo atual e não libera nada', async () => {
            const { useCases, repository, storage } = makeDeps();
            await useCases.updateAssetTerm(7, { reponsible_name: 'Beltrano' }, undefined, 1);
            expect(storage.save).not.toHaveBeenCalled();
            expect(repository.update).toHaveBeenCalledWith(7, {
                reponsible_name: 'Beltrano', active_id_fk: 42, file_id_fk: 100, file_name: 'termo.pdf',
            });
            expect(storage.remove).not.toHaveBeenCalled();
        });

        test('com arquivo novo troca a referência e libera o antigo', async () => {
            const { useCases, repository, storage } = makeDeps();
            await useCases.updateAssetTerm(7, {}, FILE, 1);
            expect(repository.update).toHaveBeenCalledWith(7, expect.objectContaining({ file_id_fk: 200, file_name: 'novo.pdf' }));
            expect(repository.countFileReferences).toHaveBeenCalledWith(100, 7);
            expect(storage.remove).toHaveBeenCalledWith(100, 1);
            // a liberação acontece depois do termo já apontar para o novo arquivo
            expect(repository.update.mock.invocationCallOrder[0]).toBeLessThan(storage.remove.mock.invocationCallOrder[0]);
        });

        test('arquivo antigo usado por outro termo não é liberado', async () => {
            const { useCases, storage } = makeDeps({ repository: { countFileReferences: jest.fn().mockResolvedValue(1) } });
            await useCases.updateAssetTerm(7, {}, FILE, 1);
            expect(storage.remove).not.toHaveBeenCalled();
        });

        test('mesmo conteúdo (deduplicado para o mesmo id) não libera o arquivo', async () => {
            const { useCases, storage } = makeDeps({ storage: { save: jest.fn().mockResolvedValue({ fileId: 100, fileName: 'termo.pdf' }) } });
            await useCases.updateAssetTerm(7, {}, FILE, 1);
            expect(storage.remove).not.toHaveBeenCalled();
        });

        test('termo inexistente: 404 sem gravar arquivo', async () => {
            const { useCases, storage } = makeDeps({ repository: { findById: jest.fn().mockResolvedValue(null) } });
            await expect(useCases.updateAssetTerm(9, {}, FILE, 1)).rejects.toMatchObject({ statusCode: 404 });
            expect(storage.save).not.toHaveBeenCalled();
        });

        test('troca para ativo inexistente: 404 sem gravar arquivo', async () => {
            const { useCases, storage } = makeDeps({ repository: { activeExists: jest.fn().mockResolvedValue(false) } });
            await expect(useCases.updateAssetTerm(7, { active_id_fk: 5 }, FILE, 1)).rejects.toMatchObject({ statusCode: 404 });
            expect(storage.save).not.toHaveBeenCalled();
        });
    });

    describe('deleteAssetTerm', () => {
        test('remove a linha e depois libera o arquivo', async () => {
            const { useCases, repository, storage } = makeDeps();
            await useCases.deleteAssetTerm(7, 1);
            expect(repository.delete).toHaveBeenCalledWith(7);
            expect(storage.remove).toHaveBeenCalledWith(100, 1);
            expect(repository.delete.mock.invocationCallOrder[0]).toBeLessThan(storage.remove.mock.invocationCallOrder[0]);
        });

        test('falha ao liberar o arquivo não desfaz a exclusão', async () => {
            const { useCases, repository } = makeDeps({ storage: { remove: jest.fn().mockRejectedValue(new Error('io')) } });
            await expect(useCases.deleteAssetTerm(7, 1)).resolves.toBeUndefined();
            expect(repository.delete).toHaveBeenCalled();
        });

        test('termo inexistente: 404', async () => {
            const { useCases, repository } = makeDeps({ repository: { findById: jest.fn().mockResolvedValue(null) } });
            await expect(useCases.deleteAssetTerm(9, 1)).rejects.toMatchObject({ statusCode: 404 });
            expect(repository.delete).not.toHaveBeenCalled();
        });
    });
});
