const { GappActiveAuditIdentifyUseCases } = require('../gapp-active-audit-identify.use-cases');
const { AUDIT_STATUS } = require('../../../../domain/gapp/active-audit/active-audit.rules');

const CURRENT_USER = { id: 1 };
const INITIAL = { assets: [{ active_id: 120, brand: 'Dell' }] };
const AUDIT = { audit_id: 15, status_audit: AUDIT_STATUS.IN_PROGRESS, initial_data: INITIAL };
const QUERY = { identifier_type: 'PATRIMONIO', identifier_value: ' 000123 ' };

function makeDeps({ repository = {}, owner = { identifier_id: 1, active_id_fk: 120 }, tx } = {}) {
    const lockedTx = tx ?? { audit: AUDIT, updateInitialData: jest.fn().mockResolvedValue({ updated: 1 }) };
    const repo = {
        findById: jest.fn().mockResolvedValue(AUDIT),
        findActivesForAudit: jest.fn().mockResolvedValue([{ active_id: 300, brand: 'HP', units_id_fk: 3 }]),
        runLocked: jest.fn().mockImplementation((_id, fn) => fn(lockedTx)),
        ...repository,
    };
    const identifierRepository = { findByValue: jest.fn().mockResolvedValue(owner) };
    const userRepository = { findAuthByAccessCode: jest.fn().mockResolvedValue({ user_id: 10, work_group_fk: 5 }) };
    const useCases = new GappActiveAuditIdentifyUseCases({ repository: repo, identifierRepository, userRepository });
    return { useCases, repo, identifierRepository, tx: lockedTx };
}

describe('identify', () => {
    test('identificador de ativo previsto → in_audit com a fotografia da abertura', async () => {
        const { useCases, identifierRepository, repo } = makeDeps();
        const result = await useCases.identify(15, QUERY, CURRENT_USER);
        expect(identifierRepository.findByValue).toHaveBeenCalledWith('PATRIMONIO', '000123');
        expect(result).toEqual({ in_audit: true, asset: INITIAL.assets[0], identifier: { identifier_type: 'PATRIMONIO', identifier_value: '000123' } });
        expect(repo.findActivesForAudit).not.toHaveBeenCalled();
    });

    test('ativo fora da auditoria → in_audit false com os dados do cadastro (só do grupo)', async () => {
        const { useCases, repo } = makeDeps({ owner: { identifier_id: 2, active_id_fk: 300 } });
        const result = await useCases.identify(15, QUERY, CURRENT_USER);
        expect(repo.findActivesForAudit).toHaveBeenCalledWith({ scope: {}, workGroupFk: 5, activeIds: [300], limit: 1 });
        expect(result).toMatchObject({ in_audit: false, asset: { active_id: 300, brand: 'HP' } });
    });

    test('identificador não cadastrado → 404', async () => {
        const { useCases } = makeDeps({ owner: null });
        await expect(useCases.identify(15, QUERY, CURRENT_USER)).rejects.toMatchObject({ statusCode: 404, code: 'GAPP_AUDIT_IDENTIFIER_UNKNOWN' });
    });

    test('ativo de outro grupo → 404', async () => {
        const { useCases } = makeDeps({ owner: { active_id_fk: 300 }, repository: { findActivesForAudit: jest.fn().mockResolvedValue([]) } });
        await expect(useCases.identify(15, QUERY, CURRENT_USER)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('identificador inválido → 400', async () => {
        const { useCases } = makeDeps();
        await expect(useCases.identify(15, { identifier_type: 'IMEI', identifier_value: '1' }, CURRENT_USER)).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('addUnexpected', () => {
    test('acrescenta como não previsto, com quem incluiu', async () => {
        const { useCases, tx } = makeDeps();
        const asset = await useCases.addUnexpected(15, 300, CURRENT_USER);
        expect(asset).toMatchObject({ active_id: 300, is_expected: false, added_by: 10 });
        const saved = tx.updateInitialData.mock.calls[0][0];
        expect(saved.assets.map(item => item.active_id)).toEqual([120, 300]);
    });

    test('ativo já na auditoria → 409', async () => {
        const { useCases, tx } = makeDeps({ repository: { findActivesForAudit: jest.fn().mockResolvedValue([{ active_id: 120 }]) } });
        await expect(useCases.addUnexpected(15, 120, CURRENT_USER)).rejects.toMatchObject({ statusCode: 409, code: 'GAPP_AUDIT_ACTIVE_ALREADY_IN' });
        expect(tx.updateInitialData).not.toHaveBeenCalled();
    });

    test.each([AUDIT_STATUS.FINISHED, AUDIT_STATUS.CANCELED])('auditoria com status %p → 409', async status => {
        const tx = { audit: { ...AUDIT, status_audit: status }, updateInitialData: jest.fn() };
        const { useCases } = makeDeps({ tx });
        await expect(useCases.addUnexpected(15, 300, CURRENT_USER)).rejects.toMatchObject({ statusCode: 409 });
        expect(tx.updateInitialData).not.toHaveBeenCalled();
    });
});
