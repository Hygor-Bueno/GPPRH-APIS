const { GappActiveAuditUseCases } = require('../gapp-active-audit.use-cases');
const { AUDIT_STATUS } = require('../../../../domain/gapp/active-audit/active-audit.rules');

const GAPP_USER = { user_id: 10, work_group_fk: 5 };
const CURRENT_USER = { id: 1 };
const INITIAL = { assets: [{ active_id: 120, brand: 'Dell' }, { active_id: 121, brand: 'Lenovo' }] };
const REFS = { unit: { unit_id: 3 }, department: { dep_id: 30, unit_id_fk: 3 }, activeClass: null, activeType: null };
const AUDIT = { audit_id: 15, status_audit: AUDIT_STATUS.OPEN, initial_data: INITIAL, final_data: null };
const ITEM = {
    active_id_fk: 120, identifier_type: 'SERIAL', identifier_value: 'SN1',
    asset_condition: 'GOOD', lifecycle_status: 'IN_USE', additional_items: { charger: true }, observations: null,
};
const OPEN_BODY = { unit_id_fk: 3, dep_id_fk: 30 };

function makeTx(overrides = {}) {
    return {
        audit: { audit_id: 15, status_audit: AUDIT_STATUS.OPEN, initial_data: INITIAL },
        findItem: jest.fn().mockResolvedValue(null),
        findActiveLocation: jest.fn().mockResolvedValue({ active_id: 120, units_id_fk: 3, used_in: 30 }),
        findRefs: jest.fn().mockResolvedValue({ unit: { unit_id: 4 }, department: { dep_id: 40, unit_id_fk: 4 } }),
        findItemByIdentifier: jest.fn().mockResolvedValue(null),
        insertItem: jest.fn().mockResolvedValue({ insertId: 1 }),
        updateItem: jest.fn().mockResolvedValue({ updated: 1 }),
        updateStatus: jest.fn().mockResolvedValue({ updated: 1 }),
        listItems: jest.fn().mockResolvedValue([]),
        findIdentifierHistory: jest.fn().mockResolvedValue([]),
        closeAudit: jest.fn().mockResolvedValue({ updated: 1 }),
        // Por padrão o banco devolve exatamente o que foi gravado.
        getFinalData: jest.fn(function getFinalData() {
            return Promise.resolve(JSON.parse(JSON.stringify(this.closeAudit.mock.calls.at(-1)[0].finalData)));
        }),
        deleteItems: jest.fn(function deleteItems() {
            return this.listItems().then(items => ({ deleted: items.length }));
        }),
        ...overrides,
    };
}

function makeDeps({ repository = {}, tx = makeTx(), gappUser = GAPP_USER } = {}) {
    const repo = {
        findRefs: jest.fn().mockResolvedValue(REFS),
        findUserNames: jest.fn().mockResolvedValue([]),
        findActivesForAudit: jest.fn().mockResolvedValue([
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
        test('com lista: grava escopo, fotografia e o usuário GAPP como responsável', async () => {
            const { useCases, repo } = makeDeps();
            await useCases.openAudit({ ...OPEN_BODY, active_ids: [120, 121, 120], user_open_id_fk: 999 }, CURRENT_USER);
            expect(repo.findActivesForAudit).toHaveBeenCalledWith({
                scope: { unit_id_fk: 3, dep_id_fk: 30, id_active_class_fk: null, active_type_id_fk: null },
                workGroupFk: 5, activeIds: [120, 121], limit: 2,
            });
            const created = repo.createAudit.mock.calls[0][0];
            expect(created).not.toHaveProperty('selection_mode');
            expect(created).not.toHaveProperty('active_type_id_fk');
            expect(repo.createAudit).toHaveBeenCalledWith(expect.objectContaining({
                user_open_id_fk: 10,
                unit_id_fk: 3, dep_id_fk: 30, id_active_class_fk: null,
                quantity_active: 2,
                initial_data: expect.objectContaining({ assets: [
                    expect.objectContaining({ active_id: 120, brand: 'Dell', value_purchase: 4500 }),
                    expect.objectContaining({ active_id: 121, brand: 'Lenovo' }),
                ] }),
            }));
        });

        test('com lista: ativo inexistente, de outro grupo ou fora do escopo → 404 com os ids', async () => {
            const { useCases, repo } = makeDeps();
            await expect(useCases.openAudit({ ...OPEN_BODY, active_ids: [120, 121, 300] }, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 404, details: { active_ids: [300] } });
            expect(repo.createAudit).not.toHaveBeenCalled();
        });

        test('sem active_ids: todos os ativos do escopo, até o teto + 1', async () => {
            const refs = { ...REFS, activeClass: { id_active_class: 7, active_type_id_fk: 2 } };
            const { useCases, repo } = makeDeps({ repository: { findRefs: jest.fn().mockResolvedValue(refs) } });
            await useCases.openAudit({ ...OPEN_BODY, id_active_class_fk: 7, active_ids: [] }, CURRENT_USER);
            expect(repo.findActivesForAudit).toHaveBeenCalledWith(expect.objectContaining({
                activeIds: null, limit: 1001,
                scope: expect.objectContaining({ unit_id_fk: 3, id_active_class_fk: 7 }),
            }));
            expect(repo.createAudit).toHaveBeenCalledWith(expect.objectContaining({
                id_active_class_fk: 7, quantity_active: 2,
                initial_data: expect.objectContaining({ scope: expect.objectContaining({ id_active_class_fk: 7 }) }),
            }));
        });

        test('sem lista e sem nenhum ativo no escopo → 404', async () => {
            const { useCases, repo } = makeDeps({ repository: { findActivesForAudit: jest.fn().mockResolvedValue([]) } });
            await expect(useCases.openAudit(OPEN_BODY, CURRENT_USER)).rejects.toMatchObject({ statusCode: 404, code: 'GAPP_AUDIT_NO_ACTIVES' });
            expect(repo.createAudit).not.toHaveBeenCalled();
        });

        test('sem lista e acima do teto → 400', async () => {
            const many = Array.from({ length: 1001 }, (_, i) => ({ active_id: i + 1 }));
            const { useCases } = makeDeps({ repository: { findActivesForAudit: jest.fn().mockResolvedValue(many) } });
            await expect(useCases.openAudit(OPEN_BODY, CURRENT_USER)).rejects.toMatchObject({ statusCode: 400, code: 'GAPP_AUDIT_TOO_MANY_ACTIVES' });
        });

        test('sem unidade → 400', async () => {
            const { useCases, repo } = makeDeps();
            await expect(useCases.openAudit({ active_ids: [120] }, CURRENT_USER)).rejects.toMatchObject({ statusCode: 400 });
            expect(repo.findActivesForAudit).not.toHaveBeenCalled();
        });

        test('setor de outra unidade → 400', async () => {
            const refs = { ...REFS, department: { dep_id: 30, unit_id_fk: 99 } };
            const { useCases } = makeDeps({ repository: { findRefs: jest.fn().mockResolvedValue(refs) } });
            await expect(useCases.openAudit(OPEN_BODY, CURRENT_USER)).rejects.toMatchObject({ statusCode: 400, code: 'GAPP_AUDIT_INVALID_SCOPE' });
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
            const tx = makeTx({ findItemByIdentifier: jest.fn().mockResolvedValue({ active_id_fk: 121, audit_id_fk: 15 }) });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.registerItem(15, ITEM, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 409, code: 'GAPP_AUDIT_IDENTIFIER_DUPLICATED' });
        });

        test('identificador já usado por outro ativo em outra auditoria → 409 e não grava', async () => {
            const tx = makeTx({ findItemByIdentifier: jest.fn().mockResolvedValue({ active_id_fk: 300, audit_id_fk: 9 }) });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.registerItem(15, ITEM, CURRENT_USER)).rejects.toMatchObject({
                statusCode: 409, code: 'GAPP_AUDIT_IDENTIFIER_IN_USE', details: { active_id: 300, audit_id: 9 },
            });
            expect(tx.insertItem).not.toHaveBeenCalled();
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

        test('mantém a transferência registrada (e a origem gravada) quando a edição não a envia', async () => {
            const transferred = {
                ...ITEM, is_transfer: 1, transfer_reason: 'Mudou',
                transfer_origin_dep_id_fk: 30, transfer_dep_id_fk: 40,
            };
            const tx = makeTx({ findItem: jest.fn().mockResolvedValue(transferred) });
            const { useCases } = makeDeps({ tx });
            await useCases.updateItem(15, 120, { observations: 'ok' }, CURRENT_USER);
            expect(tx.findActiveLocation).not.toHaveBeenCalled();
            expect(tx.updateItem).toHaveBeenCalledWith(expect.objectContaining({
                is_transfer: 1, transfer_reason: 'Mudou', observations: 'ok',
                transfer_origin_dep_id_fk: 30, transfer_dep_id_fk: 40,
            }));
        });

        test('transferência sem motivo → 400', async () => {
            const { useCases, tx } = makeDeps();
            await expect(useCases.registerItem(15, { ...ITEM, is_transfer: 1, transfer_dep_id_fk: 40 }, CURRENT_USER)).rejects.toMatchObject({ statusCode: 400 });
            expect(tx.insertItem).not.toHaveBeenCalled();
        });

        test('nova transferência: origem = gapp_active.used_in, nunca do body; sem unidade', async () => {
            const { useCases, tx } = makeDeps();
            await useCases.registerItem(15, {
                ...ITEM, is_transfer: 1, transfer_reason: 'Mudou', transfer_unit_id_fk: 999, transfer_dep_id_fk: 40,
                transfer_origin_unit_id_fk: 999,
            }, CURRENT_USER);
            expect(tx.findRefs).toHaveBeenCalledWith({ dep_id_fk: 40 });
            expect(tx.findActiveLocation).toHaveBeenCalledWith(120);
            expect(tx.insertItem).toHaveBeenCalledWith(expect.objectContaining({ transfer_origin_dep_id_fk: 30, transfer_dep_id_fk: 40 }));
            expect(tx.insertItem.mock.calls[0][0]).not.toHaveProperty('transfer_unit_id_fk');
        });

        test('destino igual à origem → 400', async () => {
            const tx = makeTx({ findRefs: jest.fn().mockResolvedValue({ department: { dep_id: 30, unit_id_fk: 3 } }) });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.registerItem(15, {
                ...ITEM, is_transfer: 1, transfer_reason: 'x', transfer_dep_id_fk: 30,
            }, CURRENT_USER)).rejects.toMatchObject({ statusCode: 400, code: 'GAPP_AUDIT_INVALID_TRANSFER' });
            expect(tx.insertItem).not.toHaveBeenCalled();
        });

        test('setor de destino inexistente → 400', async () => {
            const tx = makeTx({ findRefs: jest.fn().mockResolvedValue({ department: null }) });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.registerItem(15, {
                ...ITEM, is_transfer: 1, transfer_reason: 'x', transfer_dep_id_fk: 50,
            }, CURRENT_USER)).rejects.toMatchObject({ statusCode: 400, code: 'GAPP_AUDIT_INVALID_TRANSFER' });
            expect(tx.insertItem).not.toHaveBeenCalled();
        });

        test('sem ciclo de vida → 400', async () => {
            const { useCases } = makeDeps();
            await expect(useCases.registerItem(15, { ...ITEM, lifecycle_status: undefined }, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 400 });
        });

        test('conferência inexistente → 404', async () => {
            const { useCases } = makeDeps();
            await expect(useCases.updateItem(15, 120, { asset_condition: 'BAD' }, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 404 });
        });
    });

    describe('finishAudit', () => {
        test('consolida, confere o gravado, fecha como FINALIZADA e limpa a temporária', async () => {
            const tx = makeTx({ listItems: jest.fn().mockResolvedValue([ITEM]) });
            const { useCases } = makeDeps({ tx });
            await useCases.finishAudit(15, CURRENT_USER);

            expect(tx.findIdentifierHistory).toHaveBeenCalledWith([['SERIAL', 'SN1']]);
            const { finalData, userId, status } = tx.closeAudit.mock.calls[0][0];
            expect(userId).toBe(10);
            expect(status).toBe(AUDIT_STATUS.FINISHED);
            expect(finalData).toMatchObject({ audit_id: 15, quantity_expected: 2, quantity_found: 1, quantity_pending: 1, has_divergence: true });
            expect(finalData.items[0]).toMatchObject({ active_id: 120, lifecycle_status: 'IN_USE' });
            expect(tx.getFinalData).toHaveBeenCalled();
            expect(tx.deleteItems).toHaveBeenCalled();
        });

        test('final_data gravado diferente → erro e NÃO limpa (rollback)', async () => {
            const tx = makeTx({
                listItems: jest.fn().mockResolvedValue([ITEM]),
                getFinalData: jest.fn().mockResolvedValue({ items: [] }),
            });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.finishAudit(15, CURRENT_USER))
                .rejects.toMatchObject({ statusCode: 500, code: 'GAPP_AUDIT_FINAL_DATA_MISMATCH' });
            expect(tx.deleteItems).not.toHaveBeenCalled();
        });

        test('apagou quantidade diferente da consolidada → erro (rollback)', async () => {
            const tx = makeTx({
                listItems: jest.fn().mockResolvedValue([ITEM]),
                deleteItems: jest.fn().mockResolvedValue({ deleted: 2 }),
            });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.finishAudit(15, CURRENT_USER))
                .rejects.toMatchObject({ code: 'GAPP_AUDIT_CLEANUP_MISMATCH' });
        });

        test('identificador repetido na auditoria impede a finalização', async () => {
            const tx = makeTx({ listItems: jest.fn().mockResolvedValue([ITEM, { ...ITEM, active_id_fk: 121 }]) });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.finishAudit(15, CURRENT_USER)).rejects.toMatchObject({ statusCode: 409 });
            expect(tx.closeAudit).not.toHaveBeenCalled();
            expect(tx.deleteItems).not.toHaveBeenCalled();
        });

        test('auditoria já finalizada → 409', async () => {
            const tx = makeTx({ audit: { audit_id: 15, status_audit: AUDIT_STATUS.FINISHED, initial_data: INITIAL } });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.finishAudit(15, CURRENT_USER)).rejects.toMatchObject({ statusCode: 409 });
        });

        test('status mudou no meio (UPDATE não afetou) → 409 e não limpa', async () => {
            const tx = makeTx({ closeAudit: jest.fn().mockResolvedValue({ updated: 0 }) });
            const { useCases } = makeDeps({ tx });
            await expect(useCases.finishAudit(15, CURRENT_USER)).rejects.toMatchObject({ statusCode: 409 });
            expect(tx.deleteItems).not.toHaveBeenCalled();
        });
    });

    test('cancelamento fecha como CANCELADA com o motivo e limpa a temporária', async () => {
        const tx = makeTx({ listItems: jest.fn().mockResolvedValue([ITEM]) });
        const { useCases } = makeDeps({ tx });
        await useCases.cancelAudit(15, { reason: 'aberta por engano' }, CURRENT_USER);
        expect(tx.closeAudit).toHaveBeenCalledWith(expect.objectContaining({
            status: AUDIT_STATUS.CANCELED,
            finalData: expect.objectContaining({ canceled: true, reason: 'aberta por engano' }),
        }));
        expect(tx.deleteItems).toHaveBeenCalled();
    });

    test('auditoria encerrada: conferências vêm do final_data (nome antigo resolvido no gapp_user)', async () => {
        const closed = {
            ...AUDIT, status_audit: AUDIT_STATUS.FINISHED,
            final_data: { items: [{ active_id: 120, identifier_type: 'SERIAL', identifier_value: 'SN1', condition: 'GOOD', user_register_id: 10, transfer: null }] },
        };
        const { useCases, repo } = makeDeps({ repository: {
            findById: jest.fn().mockResolvedValue(closed),
            findUserNames: jest.fn().mockResolvedValue([{ user_id: 10, name: 'Ana' }]),
        } });
        const result = await useCases.getAuditById(15, CURRENT_USER);
        expect(repo.listItems).not.toHaveBeenCalled();
        expect(result.items).toEqual([expect.objectContaining({
            active_id_fk: 120, asset_condition: 'GOOD', user_register_name: 'Ana', audit_temp_id: null, is_transfer: 0,
        })]);
    });

    test('revisão de auditoria em aberto calcula na hora', async () => {
        const { useCases, repo } = makeDeps({ repository: { listItems: jest.fn().mockResolvedValue([ITEM]) } });
        const review = await useCases.getReview(15, CURRENT_USER);
        expect(repo.findIdentifierHistory).toHaveBeenCalledWith(15, [['SERIAL', 'SN1']]);
        expect(review).toMatchObject({ quantity_expected: 2, quantity_found: 1, quantity_pending: 1, status_label: 'ABERTA' });
    });
});
