const { GappActiveAuditUseCases } = require('../gapp-active-audit.use-cases');
const { AUDIT_STATUS } = require('../../../../domain/gapp/active-audit/active-audit.rules');

const GAPP_USER = { user_id: 10, work_group_fk: 5 };
const CURRENT_USER = { id: 1 };
const INITIAL = { assets: [{ active_id: 120, brand: 'Dell' }, { active_id: 121, brand: 'Lenovo' }] };
const AUDIT = { audit_id: 15, status_audit: AUDIT_STATUS.OPEN, initial_data: INITIAL, final_data: null };
const ITEM = {
    active_id_fk: 120, identifier_type: 'SERIAL', identifier_value: 'SN1',
    asset_condition: 'GOOD', additional_items: { charger: true }, observations: null,
};

function makeTx(overrides = {}) {
    return {
        audit: { audit_id: 15, status_audit: AUDIT_STATUS.OPEN, initial_data: INITIAL },
        findItem: jest.fn().mockResolvedValue(null),
        findItemByIdentifier: jest.fn().mockResolvedValue(null),
        insertItem: jest.fn().mockResolvedValue({ insertId: 1 }),
        updateItem: jest.fn().mockResolvedValue({ updated: 1 }),
        updateStatus: jest.fn().mockResolvedValue({ updated: 1 }),
        listItems: jest.fn().mockResolvedValue([]),
        findIdentifierHistory: jest.fn().mockResolvedValue([]),
        closeAudit: jest.fn().mockResolvedValue({ updated: 1 }),
        ...overrides,
    };
}

function makeDeps({ repository = {}, tx = makeTx(), gappUser = GAPP_USER } = {}) {
    const repo = {
        findActivesForSnapshot: jest.fn().mockResolvedValue([
            { active_id: 120, brand: 'Dell', value_purchase: '4500.00' },
            { active_id: 121, brand: 'Lenovo' },
        ]),
        createAudit: jest.fn().mockResolvedValue({ insertId: 15 }),
        list: jest.fn().mockResolvedValue({ items: [{ audit_id: 15, status_audit: 0 }], total: 1, page: 1, limit: 20 }),
        findById: jest.fn().mockResolvedValue(AUDIT),
        listItems: jest.fn().mockResolvedValue([]),
        findIdentifierHistory: jest.fn().mockResolvedValue([]),
        runLocked: jest.fn().mockImplementation((_id, fn) => fn(tx)),
        ...repository,
    };
    const userRepository = { findAuthByAccessCode: jest.fn().mockResolvedValue(gappUser) };
    return { repo, tx, useCases: new GappActiveAuditUseCases({ repository: repo, userRepository }) };
}

describe('GappActiveAuditUseCases', () => {
    test('usuário fora do GAPP recebe 404', async () => {
        const { useCases } = makeDeps({ gappUser: null });
        await expect(useCases.listAudits({}, CURRENT_USER)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('lista sempre no grupo do usuário, nunca o da query', async () => {
        const { useCases, repo } = makeDeps();
        const result = await useCases.listAudits({ work_group_fk: 999, page: 2 }, CURRENT_USER);
        expect(repo.list).toHaveBeenCalledWith({ work_group_fk: 5, page: 2 });
        expect(result.items[0].status_label).toBe('ABERTA');
    });

    test('auditoria de outro grupo é 404', async () => {
        const { useCases } = makeDeps({ repository: { findById: jest.fn().mockResolvedValue(null) } });
        await expect(useCases.getAuditById(15, CURRENT_USER)).rejects.toMatchObject({ statusCode: 404 });
    });

    describe('openAudit', () => {
        test('grava a fotografia e o usuário GAPP como responsável', async () => {
            const { useCases, repo } = makeDeps();
            await useCases.openAudit({ active_ids: [120, 121, 120], user_open_id_fk: 999 }, CURRENT_USER);
            expect(repo.findActivesForSnapshot).toHaveBeenCalledWith([120, 121], 5);
            expect(repo.createAudit).toHaveBeenCalledWith({
                user_open_id_fk: 10,
                quantity_active: 2,
                initial_data: { assets: [
                    expect.objectContaining({ active_id: 120, brand: 'Dell', value_purchase: 4500 }),
                    expect.objectContaining({ active_id: 121, brand: 'Lenovo' }),
                ] },
            });
        });

        test('ativo inexistente ou de outro grupo → 404 com os ids', async () => {
            const { useCases, repo } = makeDeps();
            await expect(useCases.openAudit({ active_ids: [120, 121, 300] }, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 404, details: { active_ids: [300] } });
            expect(repo.createAudit).not.toHaveBeenCalled();
        });

        test('lista vazia → 400', async () => {
            const { useCases } = makeDeps();
            await expect(useCases.openAudit({ active_ids: [] }, CURRENT_USER)).rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('registerItem', () => {
        test('grava com o usuário GAPP e passa a auditoria para EM ANDAMENTO', async () => {
            const { useCases, tx } = makeDeps();
            await useCases.registerItem(15, { ...ITEM, user_register_id_fk: 999 }, CURRENT_USER);
            expect(tx.insertItem).toHaveBeenCalledWith(expect.objectContaining({
                active_id_fk: 120, user_register_id_fk: 10, identifier_value: 'SN1',
            }));
            expect(tx.updateStatus).toHaveBeenCalledWith(AUDIT_STATUS.OPEN, AUDIT_STATUS.IN_PROGRESS);
        });

        test('não muda o status se já estiver EM ANDAMENTO', async () => {
            const tx = makeTx({ audit: { audit_id: 15, status_audit: AUDIT_STATUS.IN_PROGRESS, initial_data: INITIAL } });
            const { useCases } = makeDeps({ tx });
            await useCases.registerItem(15, ITEM, CURRENT_USER);
            expect(tx.updateStatus).not.toHaveBeenCalled();
        });

        test('ativo fora da auditoria → 400', async () => {
            const { useCases, repo } = makeDeps();
            await expect(useCases.registerItem(15, { ...ITEM, active_id_fk: 999 }, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 400 });
            expect(repo.runLocked).not.toHaveBeenCalled();
        });

        test('mesmo ativo duas vezes → 409', async () => {
            const tx = makeTx({ findItem: jest.fn().mockResolvedValue(ITEM) });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.registerItem(15, ITEM, CURRENT_USER)).rejects.toMatchObject({ statusCode: 409 });
            expect(tx.insertItem).not.toHaveBeenCalled();
        });

        test('identificador já usado por outro ativo da auditoria → 409', async () => {
            const tx = makeTx({ findItemByIdentifier: jest.fn().mockResolvedValue({ active_id_fk: 121 }) });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.registerItem(15, ITEM, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 409, code: 'GAPP_AUDIT_IDENTIFIER_DUPLICATED' });
        });

        test.each([AUDIT_STATUS.FINISHED, AUDIT_STATUS.CANCELED])('status %p não aceita registro (409)', async status => {
            const tx = makeTx({ audit: { audit_id: 15, status_audit: status, initial_data: INITIAL } });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.registerItem(15, ITEM, CURRENT_USER)).rejects.toMatchObject({ statusCode: 409 });
            expect(tx.insertItem).not.toHaveBeenCalled();
        });

        test('dados inválidos → 400', async () => {
            const { useCases } = makeDeps();
            await expect(useCases.registerItem(15, { ...ITEM, identifier_value: '' }, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('updateItem', () => {
        test('mantém o que não foi enviado', async () => {
            const tx = makeTx({ findItem: jest.fn().mockResolvedValue(ITEM) });
            const { useCases } = makeDeps({ tx });
            await useCases.updateItem(15, 120, { asset_condition: 'BAD' }, CURRENT_USER);
            expect(tx.updateItem).toHaveBeenCalledWith(expect.objectContaining({
                active_id_fk: 120, asset_condition: 'BAD', identifier_value: 'SN1',
                additional_items: { charger: true }, user_register_id_fk: 10,
            }));
        });

        test('mantém a transferência registrada quando a edição não a envia', async () => {
            const transferred = { ...ITEM, is_transfer: 1, transfer_reason: 'Mudou', transfer_branch_code: '0101', transfer_responsible_registration: '000123' };
            const tx = makeTx({ findItem: jest.fn().mockResolvedValue(transferred) });
            const { useCases } = makeDeps({ tx });
            await useCases.updateItem(15, 120, { observations: 'ok' }, CURRENT_USER);
            expect(tx.updateItem).toHaveBeenCalledWith(expect.objectContaining({
                is_transfer: 1, transfer_reason: 'Mudou', transfer_branch_code: '0101', transfer_responsible_registration: '000123', observations: 'ok',
            }));
        });

        test('transferência sem motivo → 400', async () => {
            const { useCases, tx } = makeDeps();
            await expect(useCases.registerItem(15, { ...ITEM, is_transfer: 1 }, CURRENT_USER)).rejects.toMatchObject({ statusCode: 400 });
            expect(tx.insertItem).not.toHaveBeenCalled();
        });

        test('conferência inexistente → 404', async () => {
            const { useCases } = makeDeps();
            await expect(useCases.updateItem(15, 120, { asset_condition: 'BAD' }, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 404 });
        });
    });

    describe('finishAudit', () => {
        test('consolida, registra pendentes como divergência e fecha como FINALIZADA', async () => {
            const tx = makeTx({ listItems: jest.fn().mockResolvedValue([ITEM]) });
            const { useCases } = makeDeps({ tx });
            await useCases.finishAudit(15, CURRENT_USER);

            expect(tx.findIdentifierHistory).toHaveBeenCalledWith([['SERIAL', 'SN1']]);
            const { finalData, userId, status } = tx.closeAudit.mock.calls[0][0];
            expect(userId).toBe(10);
            expect(status).toBe(AUDIT_STATUS.FINISHED);
            expect(finalData).toMatchObject({ audit_id: 15, quantity_expected: 2, quantity_found: 1, quantity_pending: 1, has_divergence: true });
        });

        test('identificador repetido na auditoria impede a finalização', async () => {
            const tx = makeTx({ listItems: jest.fn().mockResolvedValue([ITEM, { ...ITEM, active_id_fk: 121 }]) });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.finishAudit(15, CURRENT_USER)).rejects.toMatchObject({ statusCode: 409 });
            expect(tx.closeAudit).not.toHaveBeenCalled();
        });

        test('auditoria já finalizada → 409', async () => {
            const tx = makeTx({ audit: { audit_id: 15, status_audit: AUDIT_STATUS.FINISHED, initial_data: INITIAL } });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.finishAudit(15, CURRENT_USER)).rejects.toMatchObject({ statusCode: 409 });
        });
    });

    test('cancelamento fecha como CANCELADA com o motivo', async () => {
        const { useCases, tx } = makeDeps();
        await useCases.cancelAudit(15, { reason: 'aberta por engano' }, CURRENT_USER);
        expect(tx.closeAudit).toHaveBeenCalledWith(expect.objectContaining({
            status: AUDIT_STATUS.CANCELED,
            finalData: expect.objectContaining({ canceled: true, reason: 'aberta por engano' }),
        }));
    });

    test('revisão de auditoria em aberto calcula na hora', async () => {
        const { useCases, repo } = makeDeps({ repository: { listItems: jest.fn().mockResolvedValue([ITEM]) } });
        const review = await useCases.getReview(15, CURRENT_USER);
        expect(repo.findIdentifierHistory).toHaveBeenCalledWith(15, [['SERIAL', 'SN1']]);
        expect(review).toMatchObject({ quantity_expected: 2, quantity_found: 1, quantity_pending: 1, status_label: 'ABERTA' });
    });
});
