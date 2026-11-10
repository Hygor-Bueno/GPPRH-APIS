const { GappTermMigrationUseCases } = require('../gapp-term-migration.use-cases');
const { AppError } = require('../../../../../../errors/app.error');

const ROW = {
    migration_id: 1, source_file_name: '1235-Fulano de Tal.pdf', source_path: '1235-Fulano de Tal.pdf',
    status: 'pending', active_id_fk: null, reponsible_name: 'Fulano de Tal',
};
const VALIDATED = { ...ROW, status: 'validated', active_id_fk: 42 };
const READ = { file: { originalname: '1235-Fulano de Tal.pdf', buffer: Buffer.from('%PDF') }, sha256: 'abc', fileNames: ['1235-Fulano de Tal.pdf'] };

function makeDeps(overrides = {}) {
    const repository = {
        findKnownPaths: jest.fn().mockResolvedValue(new Set()),
        insertScanned: jest.fn().mockImplementation(async rows => ({ inserted: rows.length, failed: [] })),
        findIdsByPaths: jest.fn().mockResolvedValue([]),
        selectBatch: jest.fn().mockResolvedValue([ROW]),
        selectRetryBatch: jest.fn().mockResolvedValue([]),
        findLegacySmartphones: jest.fn().mockResolvedValue(new Map([[1235, { codigo: 1235, imei1: '351111111111111', imei2: null }]])),
        findSmartphonesByImeis: jest.fn().mockResolvedValue([{ active_id: 42, imei_1: '351111111111111', imei_2: null }]),
        isSmartphoneAsset: jest.fn().mockResolvedValue(true),
        findExistingTerm: jest.fn().mockResolvedValue(null),
        applyValidation: jest.fn().mockResolvedValue(true),
        claimForMigration: jest.fn().mockResolvedValue(true),
        markMigrated: jest.fn().mockResolvedValue(true),
        markFailed: jest.fn().mockResolvedValue(true),
        resetToPending: jest.fn().mockResolvedValue(true),
        ignore: jest.fn().mockResolvedValue(true),
        restore: jest.fn().mockResolvedValue(true),
        summary: jest.fn().mockResolvedValue({ byStatus: [], byIssue: [] }),
        list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
        findById: jest.fn().mockResolvedValue(ROW),
        listLogs: jest.fn().mockResolvedValue([]),
        insertLogs: jest.fn().mockResolvedValue(),
        ...overrides.repository,
    };
    const source = {
        describe: jest.fn().mockReturnValue({ configured: true, env: 'X', root: '/src' }),
        list: jest.fn().mockResolvedValue([]),
        read: jest.fn().mockResolvedValue(READ),
        exists: jest.fn().mockResolvedValue(true),
        ...overrides.source,
    };
    const termCreator = {
        createAssetTerm: jest.fn().mockResolvedValue({ asset_term_id: 900, file_id_fk: 700 }),
        ...overrides.termCreator,
    };
    return { repository, source, termCreator, useCases: new GappTermMigrationUseCases({ repository, source, termCreator }) };
}

describe('GappTermMigrationUseCases', () => {
    beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => { }));
    afterEach(() => jest.restoreAllMocks());

    describe('scan', () => {
        test('registra só arquivos novos e já marca nome inválido', async () => {
            const { useCases, repository } = makeDeps({
                repository: { findKnownPaths: jest.fn().mockResolvedValue(new Set(['old/5-A.pdf'])) },
                source: {
                    list: jest.fn().mockResolvedValue([
                        { relativePath: 'old/5-A.pdf', fileName: '5-A.pdf', size: 1, modifiedAt: new Date() },
                        { relativePath: '10-Fulano.pdf', fileName: '10-Fulano.pdf', size: 2, modifiedAt: new Date() },
                        { relativePath: 'sem-codigo.pdf', fileName: 'sem-codigo.pdf', size: 3, modifiedAt: new Date() },
                    ]),
                },
            });

            const result = await useCases.scan(1);

            expect(result).toEqual({ found: 3, registered: 2, already_known: 1, invalid_name: 1, failed: 0, failed_items: [] });
            const rows = repository.insertScanned.mock.calls[0][0];
            expect(rows).toHaveLength(2);
            expect(rows[0]).toMatchObject({ source_path: '10-Fulano.pdf', legacy_smartphone_code: 10, reponsible_name: 'Fulano', status: 'pending' });
            expect(rows[1]).toMatchObject({ source_path: 'sem-codigo.pdf', status: 'error', issue_code: 'INVALID_NAME' });
        });

        test('arquivo recusado pelo banco não impede os demais e volta no relatório', async () => {
            const { useCases, repository } = makeDeps({
                repository: {
                    insertScanned: jest.fn().mockResolvedValue({ inserted: 1, failed: [{ source_path: '11-B.pdf', reason: 'ER_DATA_TOO_LONG' }] }),
                    findIdsByPaths: jest.fn().mockResolvedValue([{ migration_id: 1, status: 'pending', message: null }]),
                },
                source: {
                    list: jest.fn().mockResolvedValue([
                        { relativePath: '10-A.pdf', fileName: '10-A.pdf', size: 1, modifiedAt: new Date() },
                        { relativePath: '11-B.pdf', fileName: '11-B.pdf', size: 1, modifiedAt: new Date() },
                        { relativePath: `${'p/'.repeat(260)}12-C.pdf`, fileName: '12-C.pdf', size: 1, modifiedAt: new Date() },
                    ]),
                },
            });
            const result = await useCases.scan(1);
            expect(repository.insertScanned.mock.calls[0][0]).toHaveLength(2); // o caminho longo nem vai ao banco
            expect(repository.findIdsByPaths).toHaveBeenCalledWith(['10-A.pdf']);
            expect(result).toMatchObject({ registered: 1, failed: 2 });
        });

        test('nada novo: não insere', async () => {
            const { useCases, repository } = makeDeps();
            await useCases.scan(1);
            expect(repository.insertScanned).not.toHaveBeenCalled();
        });
    });

    describe('validate', () => {
        test('código → IMEI → smartphone: validated com o ativo da base nova (nunca o código antigo)', async () => {
            const { useCases, repository } = makeDeps();
            const report = await useCases.validate({}, 1);

            expect(repository.selectBatch).toHaveBeenCalledWith({ statuses: ['pending'], ids: null, limit: 200 });
            expect(repository.findLegacySmartphones).toHaveBeenCalledWith([1235]);
            const [, expected, result] = repository.applyValidation.mock.calls[0];
            expect(expected).toBe('pending');
            expect(result).toMatchObject({ status: 'validated', active_id_fk: 42, imei: '351111111111111', imei_source: 'imei1', legacy_smartphone_code: 1235 });
            expect(report).toMatchObject({ processed: 1, validated: 1 });
        });

        test('código inexistente no legado: not_found', async () => {
            const { useCases, repository } = makeDeps({ repository: { findLegacySmartphones: jest.fn().mockResolvedValue(new Map()) } });
            await useCases.validate({}, 1);
            expect(repository.applyValidation.mock.calls[0][2]).toMatchObject({ status: 'not_found', issue_code: 'LEGACY_NOT_FOUND', active_id_fk: null });
        });

        test('IMEI sem smartphone na base nova: not_found', async () => {
            const { useCases, repository } = makeDeps({ repository: { findSmartphonesByImeis: jest.fn().mockResolvedValue([]) } });
            await useCases.validate({}, 1);
            expect(repository.applyValidation.mock.calls[0][2]).toMatchObject({ status: 'not_found', issue_code: 'ASSET_NOT_FOUND' });
        });

        test('IMEI em dois ativos: error ambíguo, sem ativo', async () => {
            const { useCases, repository } = makeDeps({
                repository: {
                    findSmartphonesByImeis: jest.fn().mockResolvedValue([
                        { active_id: 42, imei_1: '351111111111111' }, { active_id: 43, imei_2: '351111111111111' },
                    ]),
                },
            });
            await useCases.validate({}, 1);
            expect(repository.applyValidation.mock.calls[0][2]).toMatchObject({ status: 'error', issue_code: 'ASSET_AMBIGUOUS' });
            expect(repository.applyValidation.mock.calls[0][2].active_id_fk).toBeNull();
        });

        test('arquivo sumiu da pasta: error', async () => {
            const { useCases, repository } = makeDeps({ source: { exists: jest.fn().mockResolvedValue(false) } });
            await useCases.validate({}, 1);
            expect(repository.applyValidation.mock.calls[0][2]).toMatchObject({ status: 'error', issue_code: 'SOURCE_FILE_MISSING' });
        });

        test('linha que mudou de status no meio (outra instância) é pulada', async () => {
            const { useCases, repository } = makeDeps({ repository: { applyValidation: jest.fn().mockResolvedValue(false) } });
            const report = await useCases.validate({}, 1);
            expect(report).toMatchObject({ processed: 0, skipped: 1 });
            expect(repository.insertLogs).not.toHaveBeenCalled();
        });

        test('com ids: aceita revalidar o que não foi migrado', async () => {
            const { useCases, repository } = makeDeps();
            await useCases.validate({ ids: [1, 2] }, 1);
            expect(repository.selectBatch).toHaveBeenCalledWith({
                statuses: ['pending', 'validated', 'error', 'not_found'], ids: [1, 2], limit: 2,
            });
        });
    });

    describe('migrate', () => {
        test('cria o termo pelo caso de uso de termos e marca migrated', async () => {
            const { useCases, repository, termCreator } = makeDeps({ repository: { selectBatch: jest.fn().mockResolvedValue([VALIDATED]) } });
            const report = await useCases.migrate({}, 7);

            expect(repository.selectBatch).toHaveBeenCalledWith({ statuses: ['validated'], ids: null, limit: 10 });
            expect(repository.claimForMigration).toHaveBeenCalledWith(1, 7);
            expect(termCreator.createAssetTerm).toHaveBeenCalledWith({ reponsible_name: 'Fulano de Tal', active_id_fk: 42 }, READ.file, 7);
            expect(repository.markMigrated).toHaveBeenCalledWith(1, expect.objectContaining({ assetTermId: 900, fileId: 700 }), 7);
            expect(report).toMatchObject({ processed: 1, migrated: 1, reused: 0, failed: 0 });
        });

        test('vínculo já existente é reaproveitado, sem criar outro', async () => {
            const { useCases, repository, termCreator } = makeDeps({
                repository: {
                    selectBatch: jest.fn().mockResolvedValue([VALIDATED]),
                    findExistingTerm: jest.fn().mockResolvedValue({ asset_term_id: 55, file_id_fk: 66 }),
                },
            });
            const report = await useCases.migrate({}, 7);

            expect(repository.findExistingTerm).toHaveBeenCalledWith(42, 'abc', READ.fileNames);
            expect(termCreator.createAssetTerm).not.toHaveBeenCalled();
            expect(repository.markMigrated).toHaveBeenCalledWith(1, expect.objectContaining({ assetTermId: 55, fileId: 66 }), 7);
            expect(report).toMatchObject({ migrated: 1, reused: 1 });
        });

        test('linha já pega por outra instância: nada é gravado', async () => {
            const { useCases, repository, termCreator } = makeDeps({
                repository: { selectBatch: jest.fn().mockResolvedValue([VALIDATED]), claimForMigration: jest.fn().mockResolvedValue(false) },
            });
            const report = await useCases.migrate({}, 7);
            expect(termCreator.createAssetTerm).not.toHaveBeenCalled();
            expect(report).toMatchObject({ processed: 0, skipped: 1 });
        });

        test('ativo que deixou de ser smartphone: não vincula', async () => {
            const { useCases, repository, termCreator } = makeDeps({
                repository: { selectBatch: jest.fn().mockResolvedValue([VALIDATED]), isSmartphoneAsset: jest.fn().mockResolvedValue(false) },
            });
            await useCases.migrate({}, 7);
            expect(termCreator.createAssetTerm).not.toHaveBeenCalled();
            expect(repository.markFailed).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'not_found', issueCode: 'ASSET_NOT_FOUND' }), 7);
        });

        test('arquivo recusado pelo FileService (400): error FILE_REJECTED e segue o lote', async () => {
            const createAssetTerm = jest.fn()
                .mockRejectedValueOnce(new AppError('Tipo de arquivo não suportado.', 400))
                .mockResolvedValueOnce({ asset_term_id: 901, file_id_fk: 701 });
            const { useCases, repository } = makeDeps({
                repository: { selectBatch: jest.fn().mockResolvedValue([VALIDATED, { ...VALIDATED, migration_id: 2 }]) },
                termCreator: { createAssetTerm },
            });
            const report = await useCases.migrate({}, 7);

            expect(repository.markFailed).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'error', issueCode: 'FILE_REJECTED' }), 7);
            expect(report).toMatchObject({ processed: 2, migrated: 1, failed: 1, aborted: null });
        });

        test('armazenamento indisponível (503): para o lote', async () => {
            const createAssetTerm = jest.fn().mockRejectedValue(new AppError('Armazenamento indisponível', 503));
            const { useCases } = makeDeps({
                repository: { selectBatch: jest.fn().mockResolvedValue([VALIDATED, { ...VALIDATED, migration_id: 2 }]) },
                termCreator: { createAssetTerm },
            });
            const report = await useCases.migrate({}, 7);
            expect(createAssetTerm).toHaveBeenCalledTimes(1);
            expect(report.aborted).toBe('Armazenamento indisponível');
        });

        test('lote tem teto de 50', async () => {
            const { useCases, repository } = makeDeps({ repository: { selectBatch: jest.fn().mockResolvedValue([]) } });
            await useCases.migrate({ limit: 500 }, 7);
            expect(repository.selectBatch).toHaveBeenCalledWith({ statuses: ['validated'], ids: null, limit: 50 });
        });
    });

    describe('retry', () => {
        test('devolve para pending e valida de novo', async () => {
            const failed = { ...ROW, status: 'not_found', active_id_fk: null };
            const { useCases, repository } = makeDeps({ repository: { selectRetryBatch: jest.fn().mockResolvedValue([failed]) } });
            const report = await useCases.retry({}, 1);

            expect(repository.resetToPending).toHaveBeenCalledWith(1, 'not_found', 1);
            expect(repository.applyValidation.mock.calls[0][1]).toBe('pending');
            expect(report).toMatchObject({ reset: 1, validated: 1 });
        });
    });

    describe('ignore / restore', () => {
        test('ignorar registro migrado: 409', async () => {
            const { useCases } = makeDeps({
                repository: { findById: jest.fn().mockResolvedValue({ ...ROW, status: 'migrated' }), ignore: jest.fn().mockResolvedValue(false) },
            });
            await expect(useCases.ignore(1, 'x', 1)).rejects.toMatchObject({ statusCode: 409 });
        });

        test('restaurar só ignorado', async () => {
            const { useCases } = makeDeps({ repository: { restore: jest.fn().mockResolvedValue(false) } });
            await expect(useCases.restore(1, 1)).rejects.toMatchObject({ statusCode: 409 });
        });
    });

    test('summary preenche todos os status com zero', async () => {
        const { useCases } = makeDeps({
            repository: { summary: jest.fn().mockResolvedValue({ byStatus: [{ status: 'migrated', total: 3 }, { status: 'error', total: 1 }], byIssue: [{ issue_code: 'FILE_REJECTED', total: 1 }] }) },
        });
        const result = await useCases.summary();
        expect(result.total).toBe(4);
        expect(result.counts).toMatchObject({ pending: 0, migrated: 3, error: 1, not_found: 0, ignored: 0 });
        expect(result.issues).toEqual({ FILE_REJECTED: 1 });
    });
});
