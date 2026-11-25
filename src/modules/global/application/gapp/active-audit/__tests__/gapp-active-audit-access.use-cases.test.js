const { GappActiveAuditUseCases } = require('../gapp-active-audit.use-cases');
const { GappActiveAuditAssignmentUseCases } = require('../gapp-active-audit-assignment.use-cases');
const { AUDIT_STATUS } = require('../../../../domain/gapp/active-audit/active-audit.rules');

// Solicitante = _user 10; responsáveis = 20 e 21; o 30 é só do grupo.
const REQUESTER = { id: 10 };
const ASSIGNEE = { id: 21 };
const OTHER = { id: 30 };
const GAPP_USER = { user_id: 77, work_group_fk: 5 };
const INITIAL = { assets: [{ active_id: 120 }] };
const AUDIT = { audit_id: 15, user_open_id_fk: 10, assignee_ids: '20,21', status_audit: AUDIT_STATUS.OPEN, initial_data: INITIAL, final_data: null };
const ITEM = { active_id_fk: 120, identifier_type: 'SEM_IDENTIFICACAO', asset_condition: 'GOOD', lifecycle_status: 'IN_USE' };
const USERS = [{ audit_id_fk: 15, user_id: 20, name: 'Bia', file_id: 7 }, { audit_id_fk: 15, user_id: 21, name: 'Caio', file_id: null }];

function makeTx(audit = AUDIT) {
    return {
        audit,
        findItem: jest.fn().mockResolvedValue(null),
        findItemByIdentifier: jest.fn().mockResolvedValue(null),
        insertItem: jest.fn().mockResolvedValue({ insertId: 1 }),
        updateStatus: jest.fn().mockResolvedValue({ updated: 1 }),
        saveAssignees: jest.fn().mockResolvedValue(undefined),
        closeAudit: jest.fn(),
    };
}

function makeDeps(repository = {}, tx = makeTx()) {
    const repo = {
        findById: jest.fn().mockResolvedValue(AUDIT),
        findScopes: jest.fn().mockResolvedValue([]),
        findAuditUsers: jest.fn().mockResolvedValue(USERS),
        listItems: jest.fn().mockResolvedValue([]),
        // Elegíveis: todos os pedidos, menos o 99
        findAssignableUsers: jest.fn(async ids => ids.filter(id => id !== 99)),
        listAssignableUsers: jest.fn().mockResolvedValue([{ user_id: 20, name: 'Bia', file_id: null }]),
        runLocked: jest.fn().mockImplementation((_id, fn) => fn(tx)),
        ...repository,
    };
    const userRepository = { findAuthByAccessCode: jest.fn().mockResolvedValue(GAPP_USER) };
    const scopeNameResolver = { resolve: jest.fn(async rows => rows.map(row => ({ ...row, company_name: 'E', branch_name: 'L' }))) };
    const auditUseCases = new GappActiveAuditUseCases({ repository: repo, userRepository, scopeNameResolver });
    const assignment = new GappActiveAuditAssignmentUseCases({ auditUseCases, repository: repo, userRepository });
    return { repo, tx, auditUseCases, assignment };
}

describe('auditoria — quem pode o quê', () => {
    test('finalizar e cancelar: só quem abriu (o responsável recebe 403)', async () => {
        const { auditUseCases, repo } = makeDeps();
        await expect(auditUseCases.finishAudit(15, {}, ASSIGNEE)).rejects.toMatchObject({ statusCode: 403, code: 'GAPP_AUDIT_NOT_REQUESTER' });
        await expect(auditUseCases.cancelAudit(15, {}, OTHER)).rejects.toMatchObject({ statusCode: 403, code: 'GAPP_AUDIT_NOT_REQUESTER' });
        expect(repo.runLocked).not.toHaveBeenCalled();
    });

    test('conferir: qualquer responsável pode; outro do grupo recebe 403', async () => {
        const { auditUseCases, tx } = makeDeps();
        await auditUseCases.registerItem(15, ITEM, ASSIGNEE);
        expect(tx.insertItem).toHaveBeenCalledTimes(1);
        await expect(auditUseCases.registerItem(15, ITEM, OTHER)).rejects.toMatchObject({ statusCode: 403, code: 'GAPP_AUDIT_NOT_ASSIGNED' });
        expect(tx.insertItem).toHaveBeenCalledTimes(1);
    });

    test('detalhe traz os responsáveis e diz a cada um o que ele pode', async () => {
        const { auditUseCases } = makeDeps();
        const audit = await auditUseCases.getAuditById(15, REQUESTER);
        expect(audit).toMatchObject({ is_requester: true, can_register: true, assignee_ids: [20, 21] });
        expect(audit.assignees).toEqual([{ user_id: 20, name: 'Bia', file_id: 7 }, { user_id: 21, name: 'Caio', file_id: null }]);
        expect(await auditUseCases.getAuditById(15, ASSIGNEE)).toMatchObject({ is_requester: false, can_register: true });
        expect(await auditUseCases.getAuditById(15, OTHER)).toMatchObject({ is_requester: false, can_register: false });
    });
});

describe('abertura com responsáveis', () => {
    const OPENING = {
        findRefs: jest.fn().mockResolvedValue({ unit: null, department: null, activeClass: null, activeType: null }),
        findActivesForAudit: jest.fn().mockResolvedValue([{ active_id: 120 }]),
    };
    const body = ids => ({ audit_name: 'Notebooks', scope: [{ company_code: '02', branch_code: '0202' }], user_assigned_ids: ids });

    test('grava os responsáveis junto, sem repetir e sem quem abriu', async () => {
        const { repo, auditUseCases } = makeDeps({ ...OPENING, createAudit: jest.fn().mockResolvedValue({ insertId: 15 }) });
        await auditUseCases.openAudit(body([20, 21, 20, 10]), REQUESTER);
        expect(repo.findAssignableUsers).toHaveBeenCalledWith([20, 21], 5);
        expect(repo.createAudit.mock.calls[0][0]).toMatchObject({ audit: { user_open_id_fk: 10 }, assignees: [20, 21] });
    });

    test('usuário fora do grupo → 400 com os ids e não cria', async () => {
        const { repo, auditUseCases } = makeDeps({ ...OPENING, createAudit: jest.fn() });
        await expect(auditUseCases.openAudit(body([20, 99]), REQUESTER))
            .rejects.toMatchObject({ statusCode: 400, code: 'GAPP_AUDIT_INVALID_ASSIGNEE', details: { user_ids: [99] } });
        expect(repo.createAudit).not.toHaveBeenCalled();
    });
});

describe('mudar os responsáveis', () => {
    test('lista os usuários do grupo de quem pede', async () => {
        const { assignment, repo } = makeDeps();
        expect(await assignment.listAssignableUsers(REQUESTER)).toHaveLength(1);
        expect(repo.listAssignableUsers).toHaveBeenCalledWith(5);
    });

    test('quem abriu grava a lista inteira (e pode esvaziar)', async () => {
        const { assignment, tx } = makeDeps();
        await assignment.setAssignees('15', { user_assigned_ids: ['20', 31] }, REQUESTER);
        expect(tx.saveAssignees).toHaveBeenCalledWith([20, 31]);
        await assignment.setAssignees(15, { user_assigned_ids: [] }, REQUESTER);
        expect(tx.saveAssignees).toHaveBeenLastCalledWith([]);
    });

    test('responsável não muda a lista (403)', async () => {
        const { assignment, tx } = makeDeps();
        await expect(assignment.setAssignees(15, { user_assigned_ids: [30] }, ASSIGNEE)).rejects.toMatchObject({ statusCode: 403 });
        expect(tx.saveAssignees).not.toHaveBeenCalled();
    });

    test('lista inválida ou usuário fora do grupo → 400', async () => {
        const { assignment, tx } = makeDeps();
        await expect(assignment.setAssignees(15, { user_assigned_ids: 20 }, REQUESTER)).rejects.toMatchObject({ statusCode: 400 });
        await expect(assignment.setAssignees(15, { user_assigned_ids: [99] }, REQUESTER)).rejects.toMatchObject({ statusCode: 400 });
        expect(tx.saveAssignees).not.toHaveBeenCalled();
    });

    test('auditoria encerrada (vista dentro da trava) → 409', async () => {
        const { assignment, tx } = makeDeps({}, makeTx({ ...AUDIT, status_audit: AUDIT_STATUS.FINISHED }));
        await expect(assignment.setAssignees(15, { user_assigned_ids: [20] }, REQUESTER)).rejects.toMatchObject({ statusCode: 409 });
        expect(tx.saveAssignees).not.toHaveBeenCalled();
    });

    test('auditoria de outro grupo → 404', async () => {
        const { assignment } = makeDeps({ findById: jest.fn().mockResolvedValue(null) });
        await expect(assignment.setAssignees(15, { user_assigned_ids: [20] }, REQUESTER)).rejects.toMatchObject({ statusCode: 404 });
    });
});
