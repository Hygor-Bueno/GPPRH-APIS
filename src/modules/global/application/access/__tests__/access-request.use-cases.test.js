const { AccessRequestUseCases } = require('../access-request.use-cases');
const { AccessRequestRepositoryPort } = require('../ports/access-request-repository.port');
const { AppError } = require('../../../../../errors/app.error');
const {
    AccessRequestType: Type,
    AccessRequestStatus: Status,
    AccessRequestAction: Action,
    AccessErrorCode,
} = require('../../../domain/access/access-request.enums');

const OWNER = { id: 1, permissions: ['SYSTEM_OWNER'] };
const OTHER_OWNER = { id: 2, permissions: ['SYSTEM_OWNER'] };
const MANAGER = { id: 7, permissions: ['ACCESS_MANAGE'] };
const REVIEWER = { id: 8, permissions: ['ACCESS_VIEW', 'ACCESS_MANAGE', 'ACCESS_APPROVE'] };

/** Papel 1 tem SYSTEM_OWNER (permissão 1); papel 29 tem ACCESS_APPROVE (permissão 2). */
const OWNER_ROLE = 1;
const OWNER_PERMISSION = 1;
const REVIEWER_ROLE = 29;
const REVIEW_PERMISSION = 2;

function makeFakeRequestRepository(overrides = {}) {
    const repo = new AccessRequestRepositoryPort();
    repo.findRequests = jest.fn().mockResolvedValue({ rows: [], total: 0 });
    repo.findRequestById = jest.fn().mockImplementation(async id => ({
        id, type: Type.ASSIGN_USER_ROLES, status: Status.PENDING,
        target_user_id: 10, payload: { role_ids: [3] }, previous_state: { role_ids: [] },
        requested_by: MANAGER.id,
    }));
    repo.insertRequest = jest.fn().mockResolvedValue(55);
    repo.deleteRequest = jest.fn().mockResolvedValue();
    repo.claimRequest = jest.fn().mockResolvedValue(true);
    repo.releaseRequest = jest.fn().mockResolvedValue();
    repo.setTargets = jest.fn().mockResolvedValue();
    repo.setRevertResult = jest.fn().mockResolvedValue();
    repo.usernameExists = jest.fn().mockResolvedValue(false);
    repo.countPendingByType = jest.fn().mockResolvedValue({});
    repo.findReviewerIds = jest.fn().mockResolvedValue([OWNER.id, REVIEWER.id]);
    repo.findRoleIdsWithPermission = jest.fn().mockImplementation(async code => (
        code === 'SYSTEM_OWNER' ? [OWNER_ROLE] : code === 'ACCESS_APPROVE' ? [REVIEWER_ROLE] : []
    ));
    repo.findPermissionIdByCode = jest.fn().mockImplementation(async code => (
        code === 'SYSTEM_OWNER' ? OWNER_PERMISSION : code === 'ACCESS_APPROVE' ? REVIEW_PERMISSION : null
    ));
    return Object.assign(repo, overrides);
}

function makeFakeAccess(overrides = {}) {
    return {
        getUserById: jest.fn().mockImplementation(async id => ({
            id, name: 'FULANO', branch_code: '0101', administrator: 0, ad_status: 'active', permissions: 'X_USE',
        })),
        getUserRoles: jest.fn().mockResolvedValue([{ id: 2 }]),
        getUserApplications: jest.fn().mockResolvedValue([{ id: 5 }]),
        getRoleById: jest.fn().mockImplementation(async id => ({ id, name: 'X', description: null })),
        getRolePermissions: jest.fn().mockResolvedValue([{ id: 4 }]),
        getPermissionById: jest.fn().mockImplementation(async id => ({ id, code: 'X_USE', description: null })),
        prepareNewUser: jest.fn().mockImplementation(async p => ({ user: p.user, password: '$2a$10$hash' })),
        insertPreparedUser: jest.fn().mockResolvedValue({ id: 99, user: 'novo' }),
        assertRolesExist: jest.fn().mockResolvedValue(),
        assertApplicationsExist: jest.fn().mockResolvedValue(),
        prepareUserUpdate: jest.fn().mockImplementation(p => ({
            name: p.name ?? null, registration: p.registration ?? null, branch_code: p.branch_code ?? null,
            ad_status: p.ad_status ?? 'pending', administrator: p.administrator ?? 0, table_protheus: p.table_protheus ?? null,
        })),
        updateUser: jest.fn().mockResolvedValue({ id: 10 }),
        prepareUserPatch: jest.fn().mockImplementation(async f => ({ ...f })),
        applyUserPatch: jest.fn().mockResolvedValue({ id: 10 }),
        deactivateUser: jest.fn().mockResolvedValue({ deactivated: true }),
        assignRolesToUser: jest.fn().mockResolvedValue([{ id: 3 }]),
        removeRoleFromUser: jest.fn().mockResolvedValue({ removed: true }),
        grantApplicationAccess: jest.fn().mockResolvedValue([{ id: 5 }]),
        revokeApplicationAccess: jest.fn().mockResolvedValue({ revoked: true }),
        createRole: jest.fn().mockResolvedValue({ id: 40, name: 'NOVO' }),
        updateRole: jest.fn().mockResolvedValue({ id: 3 }),
        deleteRole: jest.fn().mockResolvedValue({ deleted: true }),
        restoreRole: jest.fn().mockResolvedValue({ id: 3 }),
        assignPermissionsToRole: jest.fn().mockResolvedValue([]),
        setRolePermissions: jest.fn().mockResolvedValue([]),
        removePermissionFromRole: jest.fn().mockResolvedValue({ removed: true }),
        createPermission: jest.fn().mockResolvedValue({ id: 90, code: 'NOVA' }),
        updatePermission: jest.fn().mockResolvedValue({ id: 4 }),
        deletePermission: jest.fn().mockResolvedValue({ deleted: true }),
        restorePermission: jest.fn().mockResolvedValue({ id: 4 }),
        ...overrides,
    };
}

function make({ repository, access, events } = {}) {
    const repo = repository ?? makeFakeRequestRepository();
    const acc = access ?? makeFakeAccess();
    const pub = events ?? { publish: jest.fn().mockResolvedValue() };
    return {
        useCases: new AccessRequestUseCases({ repository: repo, accessUseCases: acc, eventPublisher: pub }),
        repo, acc, pub,
    };
}

/** Registro pendente de um tipo, para os testes de revisão. */
function pendingRequest(fields) {
    return makeFakeRequestRepository({
        findRequestById: jest.fn().mockResolvedValue({
            id: 55, status: Status.PENDING, requested_by: MANAGER.id,
            target_user_id: null, target_role_id: null, target_permission_id: null,
            payload: {}, previous_state: null,
            ...fields,
        }),
    });
}

async function expectCode(promise, code, status) {
    await expect(promise).rejects.toMatchObject({ code, statusCode: status });
}

describe('AccessRequestUseCases — registro das alterações', () => {
    it('ACCESS_MANAGE aplica na hora e deixa registro pending com a foto do antes', async () => {
        const { useCases, repo, acc } = make();
        const out = await useCases.assignRolesToUser(10, ['3', 3], MANAGER);
        expect(out).toEqual([{ id: 3 }]);
        expect(acc.assignRolesToUser).toHaveBeenCalledWith(10, [3]);
        expect(repo.insertRequest).toHaveBeenCalledWith(expect.objectContaining({
            type: Type.ASSIGN_USER_ROLES, targetUserId: 10, payload: { role_ids: [3] },
            previousState: { role_ids: [2] }, status: Status.PENDING,
            requestedBy: MANAGER.id, reviewedBy: null,
        }));
    });

    it('SYSTEM_OWNER também gera registro, já approved por ele mesmo', async () => {
        const { useCases, repo } = make();
        await useCases.assignRolesToUser(10, [3], OWNER);
        expect(repo.insertRequest).toHaveBeenCalledWith(expect.objectContaining({
            status: Status.APPROVED, requestedBy: OWNER.id, reviewedBy: OWNER.id,
        }));
    });

    it('grava o registro ANTES de aplicar; se aplicar falhar, apaga e o erro sobe', async () => {
        const order = [];
        const repository = makeFakeRequestRepository({
            insertRequest: jest.fn().mockImplementation(async () => { order.push('registro'); return 55; }),
        });
        const access = makeFakeAccess({
            assignRolesToUser: jest.fn().mockImplementation(async () => { order.push('aplica'); throw new Error('boom'); }),
        });
        const { useCases, repo } = make({ repository, access });
        await expect(useCases.assignRolesToUser(10, [3], MANAGER)).rejects.toThrow('boom');
        expect(order).toEqual(['registro', 'aplica']);
        expect(repo.deleteRequest).toHaveBeenCalledWith(55);
    });

    it('criar usuário grava o hash (nunca a senha) e o id criado no registro', async () => {
        const { useCases, repo, acc } = make();
        await useCases.createUser({ user: 'novo', password: 'segredo', role_ids: [3, '3'], application_ids: [5] }, MANAGER);
        const { payload } = repo.insertRequest.mock.calls[0][0];
        expect(payload).toMatchObject({ password: '$2a$10$hash', role_ids: [3], application_ids: [5] });
        expect(JSON.stringify(payload)).not.toContain('segredo');
        expect(acc.insertPreparedUser).toHaveBeenCalledWith(
            { user: 'novo', password: '$2a$10$hash' }, MANAGER.id, { roleIds: [3], applicationIds: [5] },
        );
        expect(repo.setTargets).toHaveBeenCalledWith(55, { targetUserId: 99 });
    });

    it('criar usuário com login já existente → 409, sem registro', async () => {
        const repository = makeFakeRequestRepository({ usernameExists: jest.fn().mockResolvedValue(true) });
        const { useCases, repo } = make({ repository });
        await expectCode(useCases.createUser({ user: 'fulano' }, MANAGER), AccessErrorCode.UsernameTaken, 409);
        expect(repo.insertRequest).not.toHaveBeenCalled();
    });

    it('PUT grava todos os campos do PUT (com os padrões) e a foto deles', async () => {
        const { useCases, repo, acc } = make();
        await useCases.updateUser({ id: 10, name: 'NOVO NOME', password: 'x' }, MANAGER);
        const call = repo.insertRequest.mock.calls[0][0];
        expect(call.payload).toEqual({
            name: 'NOVO NOME', registration: null, branch_code: null,
            ad_status: 'pending', administrator: 0, table_protheus: null,
        });
        expect(call.previousState).toEqual({
            name: 'FULANO', registration: null, branch_code: '0101',
            ad_status: 'active', administrator: 0, table_protheus: null,
        });
        expect(acc.updateUser).toHaveBeenCalledWith({ ...call.payload, id: 10 }, MANAGER.id);
    });

    it('PATCH com senha: a foto não tem senha', async () => {
        const { useCases, repo } = make();
        await useCases.patchUser(10, { name: 'X', password: '$hash' }, MANAGER);
        expect(repo.insertRequest.mock.calls[0][0].previousState).toEqual({ name: 'FULANO' });
    });

    it('desativar, reset de senha, papel e permissão também geram registro', async () => {
        const { useCases, repo } = make();
        await useCases.deactivateUser(10, MANAGER);
        await useCases.recordPasswordReset(10, MANAGER);
        await useCases.createRole({ name: 'novo' }, MANAGER);
        await useCases.deleteRole(3, MANAGER);
        await useCases.createPermission({ code: 'nova' }, MANAGER);
        await useCases.updatePermission({ id: 4, code: 'x_view' }, MANAGER);
        await useCases.deletePermission(4, MANAGER);
        expect(repo.insertRequest.mock.calls.map(([c]) => c.type)).toEqual([
            Type.DEACTIVATE_USER, Type.RESET_PASSWORD, Type.CREATE_ROLE, Type.DELETE_ROLE,
            Type.CREATE_PERMISSION, Type.UPDATE_PERMISSION, Type.DELETE_PERMISSION,
        ]);
        expect(repo.insertRequest.mock.calls[3][0].previousState).toEqual({ name: 'X', description: null, permission_ids: [4] });
        expect(repo.setTargets).toHaveBeenCalledWith(55, { targetRoleId: 40 });
        expect(repo.setTargets).toHaveBeenCalledWith(55, { targetPermissionId: 90 });
    });

    it('lista de ids inválida → 400 INVALID_IDS, sem registro', async () => {
        const { useCases, repo } = make();
        await expectCode(useCases.assignRolesToUser(10, [0, 'x'], MANAGER), AccessErrorCode.InvalidIds, 400);
        await expectCode(useCases.assignRolesToUser(10, [], MANAGER), AccessErrorCode.InvalidIds, 400);
        expect(repo.insertRequest).not.toHaveBeenCalled();
    });
});

describe('AccessRequestUseCases — SYSTEM_OWNER só pelo banco', () => {
    it.each([
        ['dar papel de dono', uc => uc.assignRolesToUser(10, [OWNER_ROLE], OWNER)],
        ['tirar papel de dono', uc => uc.removeRoleFromUser(10, OWNER_ROLE, OWNER)],
        ['criar usuário com papel de dono', uc => uc.createUser({ user: 'x', role_ids: [OWNER_ROLE] }, OWNER)],
        ['editar papel de dono', uc => uc.updateRole({ id: OWNER_ROLE, name: 'X' }, OWNER)],
        ['mexer nas permissões do papel de dono', uc => uc.setRolePermissions(OWNER_ROLE, [], OWNER)],
        ['pôr SYSTEM_OWNER num papel', uc => uc.assignPermissionsToRole(3, [OWNER_PERMISSION], OWNER)],
        ['renomear SYSTEM_OWNER', uc => uc.updatePermission({ id: OWNER_PERMISSION, code: 'X' }, OWNER)],
        ['excluir SYSTEM_OWNER', uc => uc.deletePermission(OWNER_PERMISSION, OWNER)],
    ])('%s → 403 OWNER_PROTECTED, até para dono', async (_, run) => {
        const { useCases, repo } = make();
        await expectCode(run(useCases), AccessErrorCode.OwnerProtected, 403);
        expect(repo.insertRequest).not.toHaveBeenCalled();
    });
});

describe('AccessRequestUseCases — ACCESS_APPROVE só pelo dono', () => {
    const cases = [
        ['dar papel de revisor', (uc, actor) => uc.assignRolesToUser(10, [REVIEWER_ROLE], actor)],
        ['tirar papel de revisor', (uc, actor) => uc.removeRoleFromUser(10, REVIEWER_ROLE, actor)],
        ['criar usuário com papel de revisor', (uc, actor) => uc.createUser({ user: 'x', role_ids: [3, REVIEWER_ROLE] }, actor)],
        ['mexer nas permissões do papel de revisor', (uc, actor) => uc.setRolePermissions(REVIEWER_ROLE, [4], actor)],
        ['renomear o papel de revisor', (uc, actor) => uc.updateRole({ id: REVIEWER_ROLE, name: 'X' }, actor)],
        ['pôr ACCESS_APPROVE num papel', (uc, actor) => uc.assignPermissionsToRole(3, [4, REVIEW_PERMISSION], actor)],
        ['renomear ACCESS_APPROVE', (uc, actor) => uc.updatePermission({ id: REVIEW_PERMISSION, code: 'X' }, actor)],
        ['excluir ACCESS_APPROVE', (uc, actor) => uc.deletePermission(REVIEW_PERMISSION, actor)],
    ];

    it.each(cases)('%s → 403 REVIEWER_PROTECTED para quem não é dono', async (_, run) => {
        const { useCases, repo } = make();
        await expectCode(run(useCases, MANAGER), AccessErrorCode.ReviewerProtected, 403);
        expect(repo.insertRequest).not.toHaveBeenCalled();
    });

    it.each(cases)('%s → o dono pode', async (_, run) => {
        const { useCases, repo } = make();
        await run(useCases, OWNER);
        expect(repo.insertRequest).toHaveBeenCalled();
    });

    it('nem um revisor dá o papel de revisor a outro', async () => {
        const { useCases } = make();
        await expectCode(useCases.assignRolesToUser(10, [REVIEWER_ROLE], REVIEWER), AccessErrorCode.ReviewerProtected, 403);
    });
});

describe('AccessRequestUseCases — próprio cadastro e conta de dono', () => {
    it.each([
        ['editar', uc => uc.patchUser(MANAGER.id, { name: 'X' }, MANAGER)],
        ['dar papel', uc => uc.assignRolesToUser(MANAGER.id, [3], MANAGER)],
        ['dar aplicação', uc => uc.grantApplicationAccess(MANAGER.id, 5, MANAGER)],
        ['desativar', uc => uc.deactivateUser(MANAGER.id, MANAGER)],
        ['resetar a senha', uc => uc.assertCanManageUserById(MANAGER.id, MANAGER)],
    ])('ninguém além do dono pode %s o próprio cadastro → 403 SELF_EDIT', async (_, run) => {
        const { useCases } = make();
        await expectCode(run(useCases), AccessErrorCode.SelfEdit, 403);
    });

    it('dono altera o próprio cadastro', async () => {
        const access = makeFakeAccess({
            getUserById: jest.fn().mockResolvedValue({ id: OWNER.id, permissions: 'SYSTEM_OWNER' }),
        });
        const { useCases, acc } = make({ access });
        await useCases.patchUser(OWNER.id, { name: 'X' }, OWNER);
        expect(acc.applyUserPatch).toHaveBeenCalled();
    });

    it('mexer nas permissões de um papel que tem → 403 SELF_EDIT', async () => {
        const access = makeFakeAccess({ getUserRoles: jest.fn().mockResolvedValue([{ id: 3 }]) });
        const { useCases } = make({ access });
        await expectCode(useCases.assignPermissionsToRole(3, [4], MANAGER), AccessErrorCode.SelfEdit, 403);
    });

    it('conta de dono só outro dono altera', async () => {
        const access = makeFakeAccess({
            getUserById: jest.fn().mockResolvedValue({ id: 2, permissions: 'MIEPP_USE,SYSTEM_OWNER' }),
        });
        const { useCases } = make({ access });
        await expectCode(useCases.patchUser(2, { name: 'X' }, MANAGER), AccessErrorCode.TargetIsOwner, 403);
        await expect(useCases.patchUser(2, { name: 'X' }, OWNER)).resolves.toBeDefined();
    });
});

describe('AccessRequestUseCases — revisão', () => {
    it('aprovar só fecha o registro (com a nota) e avisa revisores e autor', async () => {
        const { useCases, repo, acc, pub } = make();
        await useCases.approve(55, REVIEWER, 'ok');
        expect(repo.claimRequest).toHaveBeenCalledWith(55, Status.APPROVED, REVIEWER.id, 'ok');
        expect(acc.removeRoleFromUser).not.toHaveBeenCalled();
        expect(pub.publish).toHaveBeenCalledWith([OWNER.id, REVIEWER.id, MANAGER.id], expect.objectContaining({ action: Action.APPROVED }));
    });

    it('ninguém revisa a própria alteração → 403', async () => {
        const { useCases } = make();
        await expectCode(useCases.approve(55, { ...REVIEWER, id: MANAGER.id }), AccessErrorCode.SelfReview, 403);
    });

    it('revisor não revisa alteração no próprio cadastro → 403; dono pode', async () => {
        const repository = pendingRequest({ type: Type.ASSIGN_USER_ROLES, target_user_id: REVIEWER.id });
        const { useCases } = make({ repository });
        await expectCode(useCases.approve(55, REVIEWER), AccessErrorCode.SelfTarget, 403);
        await expect(useCases.approve(55, OWNER)).resolves.toBeDefined();
    });

    it('outro revisor já analisou (corrida) → 409, sem desfazer', async () => {
        const repository = makeFakeRequestRepository({ claimRequest: jest.fn().mockResolvedValue(false) });
        const { useCases, acc } = make({ repository });
        await expectCode(useCases.reject(55, REVIEWER), AccessErrorCode.RequestNotPending, 409);
        expect(acc.removeRoleFromUser).not.toHaveBeenCalled();
    });

    it('registro já revisado → 409', async () => {
        const repository = pendingRequest({ status: Status.APPROVED });
        const { useCases } = make({ repository });
        await expectCode(useCases.reject(55, REVIEWER), AccessErrorCode.RequestNotPending, 409);
    });

    it('registro inexistente → 404', async () => {
        const repository = makeFakeRequestRepository({ findRequestById: jest.fn().mockResolvedValue(null) });
        const { useCases } = make({ repository });
        await expectCode(useCases.getById(9), AccessErrorCode.RequestNotFound, 404);
    });
});

describe('AccessRequestUseCases — recusar desfaz', () => {
    it('papéis: tira só o que a alteração acrescentou e grava o resultado', async () => {
        const repository = pendingRequest({
            type: Type.ASSIGN_USER_ROLES, target_user_id: 10,
            payload: { role_ids: [2, 3] }, previous_state: { role_ids: [2] },
        });
        const { useCases, repo, acc, pub } = make({ repository });
        await useCases.reject(55, REVIEWER, 'não autorizado');
        expect(repo.claimRequest).toHaveBeenCalledWith(55, Status.REJECTED, REVIEWER.id, 'não autorizado');
        expect(acc.removeRoleFromUser.mock.calls).toEqual([[10, 3]]);
        expect(repo.setRevertResult).toHaveBeenCalledWith(55, { complete: true, undone: ['papel 3 retirado'], skipped: [] });
        expect(pub.publish).toHaveBeenCalledWith(expect.arrayContaining([MANAGER.id]), expect.objectContaining({ action: Action.REJECTED }));
    });

    it('campos: volta o que ainda está como a alteração deixou; o resto fica', async () => {
        const repository = pendingRequest({
            type: Type.PATCH_USER, target_user_id: 10,
            payload: { name: 'NOVO', branch_code: '0202', password: '$hash' },
            previous_state: { name: 'ANTIGO', branch_code: '0101' },
        });
        const access = makeFakeAccess({
            getUserById: jest.fn().mockResolvedValue({ id: 10, name: 'NOVO', branch_code: '0303' }),
        });
        const { useCases, repo, acc } = make({ repository, access });
        await useCases.reject(55, REVIEWER);
        expect(acc.applyUserPatch).toHaveBeenCalledWith(10, { name: 'ANTIGO' }, REVIEWER.id);
        const result = repo.setRevertResult.mock.calls[0][1];
        expect(result.complete).toBe(false);
        expect(result.skipped).toEqual([
            'branch_code: foi alterado de novo depois; ficou como está.',
            'senha: a anterior não é guardada; resete a senha se preciso.',
        ]);
    });

    it('criação de usuário: desativa e tira papéis e aplicações dados', async () => {
        const repository = pendingRequest({
            type: Type.CREATE_USER, target_user_id: 99,
            payload: { user: 'novo', role_ids: [3], application_ids: [5] },
        });
        const { useCases, acc } = make({ repository });
        await useCases.reject(55, REVIEWER);
        expect(acc.deactivateUser).toHaveBeenCalledWith(99, REVIEWER.id);
        expect(acc.removeRoleFromUser).toHaveBeenCalledWith(99, 3);
        expect(acc.revokeApplicationAccess).toHaveBeenCalledWith(99, 5);
    });

    it('permissões do papel (PUT): tira as acrescentadas e devolve as tiradas', async () => {
        const repository = pendingRequest({
            type: Type.SET_ROLE_PERMISSIONS, target_role_id: 3,
            payload: { permission_ids: [4, 6] }, previous_state: { permission_ids: [4, 5] },
        });
        const { useCases, acc } = make({ repository });
        await useCases.reject(55, REVIEWER);
        expect(acc.removePermissionFromRole).toHaveBeenCalledWith(3, 6);
        expect(acc.assignPermissionsToRole).toHaveBeenCalledWith(3, [5]);
    });

    it('exclusão de papel: recria com o mesmo id e as permissões', async () => {
        const repository = pendingRequest({
            type: Type.DELETE_ROLE, target_role_id: 3,
            previous_state: { name: 'X', description: 'd', permission_ids: [4] },
        });
        const { useCases, acc } = make({ repository });
        await useCases.reject(55, REVIEWER);
        expect(acc.restoreRole).toHaveBeenCalledWith({ id: 3, name: 'X', description: 'd' }, [4]);
    });

    it('acesso dado a uma aplicação que a pessoa já tinha: nada a desfazer', async () => {
        const repository = pendingRequest({
            type: Type.GRANT_USER_APPLICATION, target_user_id: 10,
            payload: { application_id: 5 }, previous_state: { had: true },
        });
        const { useCases, acc } = make({ repository });
        await useCases.reject(55, REVIEWER);
        expect(acc.revokeApplicationAccess).not.toHaveBeenCalled();
    });

    it('reset de senha: recusa, mas avisa que não tem como desfazer', async () => {
        const repository = pendingRequest({ type: Type.RESET_PASSWORD, target_user_id: 10 });
        const { useCases, repo } = make({ repository });
        await useCases.reject(55, REVIEWER);
        expect(repo.setRevertResult.mock.calls[0][1]).toMatchObject({ complete: false, undone: [] });
    });

    it('passo que esbarra em 4xx vira skipped e a recusa segue', async () => {
        const repository = pendingRequest({ type: Type.CREATE_ROLE, target_role_id: 40 });
        const access = makeFakeAccess({
            deleteRole: jest.fn().mockRejectedValue(new AppError('Não é possível excluir: 2 usuário(s) possuem este papel.', 409)),
        });
        const { useCases, repo } = make({ repository, access });
        await useCases.reject(55, REVIEWER);
        expect(repo.releaseRequest).not.toHaveBeenCalled();
        expect(repo.setRevertResult.mock.calls[0][1].skipped).toEqual([
            'papel excluído: Não é possível excluir: 2 usuário(s) possuem este papel.',
        ]);
    });

    it('erro de banco ao desfazer: volta para pending e o erro sobe', async () => {
        const access = makeFakeAccess({ removeRoleFromUser: jest.fn().mockRejectedValue(new AppError('db', 500)) });
        const { useCases, repo } = make({ access });
        await expect(useCases.reject(55, REVIEWER)).rejects.toThrow('db');
        expect(repo.releaseRequest).toHaveBeenCalledWith(55);
        expect(repo.setRevertResult).not.toHaveBeenCalled();
    });
});

describe('AccessRequestUseCases — avisos e sino', () => {
    it('alteração nova avisa os revisores, não o autor', async () => {
        const { useCases, pub } = make();
        await useCases.assignRolesToUser(10, [3], MANAGER);
        expect(pub.publish).toHaveBeenCalledWith([OWNER.id, REVIEWER.id], expect.objectContaining({ action: Action.REQUESTED }));
    });

    it('alteração de dono não avisa ninguém', async () => {
        const { useCases, pub } = make();
        await useCases.assignRolesToUser(10, [3], OWNER);
        expect(pub.publish).not.toHaveBeenCalled();
    });

    it('falha ao avisar não derruba a alteração', async () => {
        const events = { publish: jest.fn().mockRejectedValue(new Error('ws fora')) };
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { useCases } = make({ events });
        await expect(useCases.assignRolesToUser(10, [3], MANAGER)).resolves.toEqual([{ id: 3 }]);
        spy.mockRestore();
    });

    it('summary soma os pendentes por tipo e traz os mais recentes sem senha', async () => {
        const repository = makeFakeRequestRepository({
            countPendingByType: jest.fn().mockResolvedValue({ create_user: 2, patch_user: 1 }),
            findRequests: jest.fn().mockResolvedValue({
                rows: [{ id: 3, payload: '{"user":"x","password":"$hash"}', previous_state: null, revert_result: null }],
                total: 1,
            }),
        });
        const { useCases } = make({ repository });
        const out = await useCases.summary();
        expect(out.pending_total).toBe(3);
        expect(out.latest[0].payload).toEqual({ user: 'x' });
        expect(out.latest[0].sets_password).toBe(true);
    });
});

describe('AccessRequestUseCases — listagem', () => {
    it('padrão é pending; status=all tira o filtro', async () => {
        const { useCases, repo } = make();
        await useCases.list({});
        expect(repo.findRequests.mock.calls[0][0].status).toBe(Status.PENDING);
        await useCases.list({ status: 'all' });
        expect(repo.findRequests.mock.calls[1][0].status).toBeNull();
    });

    it('status ou tipo desconhecido → 400', async () => {
        const { useCases } = make();
        await expectCode(useCases.list({ status: 'x' }), AccessErrorCode.InvalidRequestStatus, 400);
        await expectCode(useCases.list({ type: 'x' }), AccessErrorCode.InvalidRequestType, 400);
    });

    it('aceita os tipos novos no filtro', async () => {
        const { useCases } = make();
        await expect(useCases.list({ type: Type.DELETE_ROLE })).resolves.toBeDefined();
    });
});
