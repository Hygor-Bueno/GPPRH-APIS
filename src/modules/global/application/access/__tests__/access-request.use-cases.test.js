const { AccessRequestUseCases } = require('../access-request.use-cases');
const { AccessRequestRepositoryPort } = require('../ports/access-request-repository.port');
const { AccessRequestType, AccessRequestStatus, AccessErrorCode } = require('../../../domain/access/access-request.enums');

const OWNER = { id: 1, permissions: ['SYSTEM_OWNER'] };
const MANAGER = { id: 7, permissions: ['ACCESS_MANAGE'] };
const OTHER_OWNER = { id: 2, permissions: ['SYSTEM_OWNER'] };

function makeFakeRequestRepository(overrides = {}) {
    const repo = new AccessRequestRepositoryPort();
    repo.findRequests = jest.fn().mockResolvedValue({ rows: [], total: 0 });
    repo.findRequestById = jest.fn().mockImplementation(async id => ({
        id, type: AccessRequestType.ASSIGN_USER_ROLES, status: AccessRequestStatus.PENDING,
        target_user_id: 10, payload: { role_ids: [3] }, requested_by: MANAGER.id,
    }));
    repo.insertRequest = jest.fn().mockResolvedValue(55);
    repo.claimRequest = jest.fn().mockResolvedValue(true);
    repo.releaseRequest = jest.fn().mockResolvedValue();
    repo.setTargetUser = jest.fn().mockResolvedValue();
    repo.usernameExists = jest.fn().mockResolvedValue(false);
    repo.hasPendingCreateUser = jest.fn().mockResolvedValue(false);
    repo.countPendingByType = jest.fn().mockResolvedValue({});
    repo.findApproverIds = jest.fn().mockResolvedValue([OWNER.id, OTHER_OWNER.id]);
    return Object.assign(repo, overrides);
}

function makeFakeAccess(overrides = {}) {
    return {
        getUserById: jest.fn().mockResolvedValue({ id: 10, administrator: 0, ad_status: 'active' }),
        getRoleById: jest.fn().mockResolvedValue({ id: 3, name: 'X' }),
        getPermissionById: jest.fn().mockResolvedValue({ id: 4, code: 'X_USE' }),
        prepareNewUser: jest.fn().mockImplementation(async p => ({ ...p, password: '$2a$10$hash' })),
        insertPreparedUser: jest.fn().mockResolvedValue({ id: 99, user: 'novo' }),
        assertRolesExist: jest.fn().mockResolvedValue(),
        assertApplicationsExist: jest.fn().mockResolvedValue(),
        prepareUserPatch: jest.fn().mockImplementation(async f => ({ ...f })),
        applyUserPatch: jest.fn().mockResolvedValue({ id: 10 }),
        updateUser: jest.fn().mockResolvedValue({ id: 10 }),
        deactivateUser: jest.fn().mockResolvedValue({ deactivated: true }),
        assignRolesToUser: jest.fn().mockResolvedValue([{ id: 3 }]),
        removeRoleFromUser: jest.fn().mockResolvedValue({ removed: true }),
        grantApplicationAccess: jest.fn().mockResolvedValue([{ id: 5 }]),
        revokeApplicationAccess: jest.fn().mockResolvedValue({ revoked: true }),
        assignPermissionsToRole: jest.fn().mockResolvedValue([]),
        setRolePermissions: jest.fn().mockResolvedValue([]),
        removePermissionFromRole: jest.fn().mockResolvedValue({ removed: true }),
        updatePermission: jest.fn().mockResolvedValue({ id: 4 }),
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

async function expectCode(promise, code, status) {
    await expect(promise).rejects.toMatchObject({ code, statusCode: status });
}

describe('AccessRequestUseCases — quem entra na fila', () => {
    it('SYSTEM_OWNER aplica na hora e não grava pedido', async () => {
        const { useCases, repo, acc } = make();
        const out = await useCases.assignRolesToUser(10, [3], OWNER);
        expect(out).toEqual({ pending: false, data: [{ id: 3 }] });
        expect(acc.assignRolesToUser).toHaveBeenCalledWith(10, [3]);
        expect(repo.insertRequest).not.toHaveBeenCalled();
    });

    it('ACCESS_MANAGE gera pedido pendente e não aplica nada', async () => {
        const { useCases, repo, acc } = make();
        const out = await useCases.assignRolesToUser(10, ['3', 3], MANAGER);
        expect(out.pending).toBe(true);
        expect(acc.assignRolesToUser).not.toHaveBeenCalled();
        expect(repo.insertRequest).toHaveBeenCalledWith({
            type: AccessRequestType.ASSIGN_USER_ROLES, targetUserId: 10,
            payload: { role_ids: [3] }, requestedBy: MANAGER.id,
        });
    });

    it.each([
        ['removeRoleFromUser', [10, 3], AccessRequestType.REMOVE_USER_ROLE],
        ['grantApplicationAccess', [10, 5], AccessRequestType.GRANT_USER_APPLICATION],
        ['revokeApplicationAccess', [10, 5], AccessRequestType.REVOKE_USER_APPLICATION],
        ['assignPermissionsToRole', [3, [4]], AccessRequestType.ASSIGN_ROLE_PERMISSIONS],
        ['setRolePermissions', [3, []], AccessRequestType.SET_ROLE_PERMISSIONS],
        ['removePermissionFromRole', [3, 4], AccessRequestType.REMOVE_ROLE_PERMISSION],
    ])('%s de quem não é dono vira pedido %s', async (method, args, type) => {
        const { useCases, repo } = make();
        const out = await useCases[method](...args, MANAGER);
        expect(out.pending).toBe(true);
        expect(repo.insertRequest.mock.calls[0][0].type).toBe(type);
    });

    it('renomear permissão vira pedido', async () => {
        const { useCases, repo, acc } = make();
        await useCases.updatePermission({ id: 4, code: 'SYSTEM_OWNER' }, MANAGER);
        expect(acc.updatePermission).not.toHaveBeenCalled();
        expect(repo.insertRequest.mock.calls[0][0]).toMatchObject({
            type: AccessRequestType.UPDATE_PERMISSION, targetPermissionId: 4,
        });
    });

    it('criar usuário grava o hash, nunca a senha em claro', async () => {
        const { useCases, repo } = make();
        await useCases.createUser({ user: 'novo', password: 'segredo' }, MANAGER);
        const { payload } = repo.insertRequest.mock.calls[0][0];
        expect(payload.password).toBe('$2a$10$hash');
        expect(JSON.stringify(payload)).not.toContain('segredo');
    });

    it('criar usuário com login já existente → 409 USERNAME_TAKEN', async () => {
        const repository = makeFakeRequestRepository({ usernameExists: jest.fn().mockResolvedValue(true) });
        const { useCases } = make({ repository });
        await expectCode(useCases.createUser({ user: 'fulano' }, MANAGER), AccessErrorCode.UsernameTaken, 409);
    });

    it('criar usuário já pedido e pendente → 409 REQUEST_DUPLICATE', async () => {
        const repository = makeFakeRequestRepository({ hasPendingCreateUser: jest.fn().mockResolvedValue(true) });
        const { useCases } = make({ repository });
        await expectCode(useCases.createUser({ user: 'fulano' }, MANAGER), AccessErrorCode.RequestDuplicate, 409);
    });

    it('lista de ids inválida → 400 INVALID_IDS, sem gravar', async () => {
        const { useCases, repo } = make();
        await expectCode(useCases.assignRolesToUser(10, [0, 'x'], MANAGER), AccessErrorCode.InvalidIds, 400);
        await expectCode(useCases.assignRolesToUser(10, [], MANAGER), AccessErrorCode.InvalidIds, 400);
        expect(repo.insertRequest).not.toHaveBeenCalled();
    });
});

describe('AccessRequestUseCases — criar usuário com papéis e aplicações', () => {
    const body = { user: 'novo', name: 'Novo', role_ids: [23, '23', 9], application_ids: [1, 39] };

    it('gestor: UM pedido com o usuário e as duas listas (sem repetição)', async () => {
        const { useCases, repo, acc } = make();
        const out = await useCases.createUser(body, MANAGER);
        expect(out.pending).toBe(true);
        expect(repo.insertRequest).toHaveBeenCalledTimes(1);
        const { type, payload } = repo.insertRequest.mock.calls[0][0];
        expect(type).toBe(AccessRequestType.CREATE_USER);
        expect(payload).toMatchObject({ user: 'novo', role_ids: [23, 9], application_ids: [1, 39] });
        expect(acc.insertPreparedUser).not.toHaveBeenCalled();
    });

    it('dono: cria com as listas na hora', async () => {
        const { useCases, acc } = make();
        const out = await useCases.createUser(body, OWNER);
        expect(out.pending).toBe(false);
        const [userData, author, access] = acc.insertPreparedUser.mock.calls[0];
        expect(userData.role_ids).toBeUndefined();
        expect(userData.application_ids).toBeUndefined();
        expect(author).toBe(OWNER.id);
        expect(access).toEqual({ roleIds: [23, 9], applicationIds: [1, 39] });
    });

    it('aprovar o pedido aplica usuário, papéis e aplicações juntos', async () => {
        const repository = makeFakeRequestRepository({
            findRequestById: jest.fn().mockResolvedValue({
                id: 57, type: AccessRequestType.CREATE_USER, status: 'pending', requested_by: MANAGER.id,
                payload: { user: 'novo', password: 'h', role_ids: [23], application_ids: [1] },
            }),
        });
        const { useCases, acc } = make({ repository });
        await useCases.approve(57, OWNER);
        expect(acc.insertPreparedUser).toHaveBeenCalledWith(
            { user: 'novo', password: 'h' }, MANAGER.id, { roleIds: [23], applicationIds: [1] });
    });

    it('confere os ids antes de gerar o pedido', async () => {
        const { AppError } = require('../../../../../errors/app.error');
        const access = makeFakeAccess({
            assertRolesExist: jest.fn().mockRejectedValue(
                new AppError('Papel inexistente: 999.', 400, { code: AccessErrorCode.UnknownRole })),
        });
        const { useCases, repo } = make({ access });
        await expectCode(useCases.createUser({ user: 'novo', role_ids: [999] }, MANAGER), AccessErrorCode.UnknownRole, 400);
        expect(repo.insertRequest).not.toHaveBeenCalled();
    });

    it('lista malformada → 400 INVALID_IDS', async () => {
        const { useCases } = make();
        await expectCode(useCases.createUser({ user: 'novo', role_ids: 'admin' }, MANAGER), AccessErrorCode.InvalidIds, 400);
        await expectCode(useCases.createUser({ user: 'novo', application_ids: [0] }, MANAGER), AccessErrorCode.InvalidIds, 400);
    });

    it('sem listas continua funcionando (listas vazias no pedido)', async () => {
        const { useCases, repo } = make();
        await useCases.createUser({ user: 'novo' }, MANAGER);
        expect(repo.insertRequest.mock.calls[0][0].payload).toMatchObject({ role_ids: [], application_ids: [] });
    });
});

describe('AccessRequestUseCases — edição de usuário', () => {
    it('PATCH de nome/senha aplica na hora mesmo sem ser dono', async () => {
        const { useCases, repo, acc } = make();
        const out = await useCases.patchUser(10, { name: 'X', password: 'nova' }, MANAGER);
        expect(out.pending).toBe(false);
        expect(acc.applyUserPatch).toHaveBeenCalled();
        expect(repo.insertRequest).not.toHaveBeenCalled();
    });

    it('PATCH que bloqueia aplica na hora', async () => {
        const { useCases, repo } = make();
        const out = await useCases.patchUser(10, { ad_status: 'blocked' }, MANAGER);
        expect(out.pending).toBe(false);
        expect(repo.insertRequest).not.toHaveBeenCalled();
    });

    it('PATCH que ativa usuário bloqueado vira pedido', async () => {
        const access = makeFakeAccess({
            getUserById: jest.fn().mockResolvedValue({ id: 10, administrator: 0, ad_status: 'blocked' }),
        });
        const { useCases, acc } = make({ access });
        const out = await useCases.patchUser(10, { ad_status: 'active' }, MANAGER);
        expect(out.pending).toBe(true);
        expect(acc.applyUserPatch).not.toHaveBeenCalled();
    });

    it('PUT que muda administrator vira pedido, só com os campos do PUT', async () => {
        const { useCases, repo, acc } = make();
        const out = await useCases.updateUser(
            { id: 10, name: 'X', ad_status: 'active', administrator: 1, password: 'vaza' }, MANAGER);
        expect(out.pending).toBe(true);
        expect(acc.updateUser).not.toHaveBeenCalled();
        const { payload } = repo.insertRequest.mock.calls[0][0];
        expect(payload).toEqual({ name: 'X', ad_status: 'active', administrator: 1 });
    });

    it('PUT que não concede acesso aplica na hora', async () => {
        const { useCases, acc } = make();
        const out = await useCases.updateUser({ id: 10, name: 'X', ad_status: 'active', administrator: 0 }, MANAGER);
        expect(out.pending).toBe(false);
        expect(acc.updateUser).toHaveBeenCalledWith({ id: 10, name: 'X', ad_status: 'active', administrator: 0 }, MANAGER.id);
    });
});

describe('AccessRequestUseCases — conta de dono do sistema', () => {
    const ownerAccount = () => makeFakeAccess({
        getUserById: jest.fn().mockResolvedValue({
            id: 1, administrator: 0, ad_status: 'active', permissions: 'ACCESS_MANAGE,SYSTEM_OWNER',
        }),
    });

    it.each([
        ['patchUser (senha)', uc => uc.patchUser(1, { password: 'nova' }, MANAGER), 'applyUserPatch'],
        ['patchUser (bloqueio)', uc => uc.patchUser(1, { ad_status: 'blocked' }, MANAGER), 'applyUserPatch'],
        ['updateUser', uc => uc.updateUser({ id: 1, name: 'X', ad_status: 'active', administrator: 0 }, MANAGER), 'updateUser'],
        ['deactivateUser', uc => uc.deactivateUser(1, MANAGER), 'deactivateUser'],
    ])('%s por quem não é dono → 403 TARGET_IS_OWNER, nada aplicado', async (_, call, applyMethod) => {
        const { useCases, repo, acc } = make({ access: ownerAccount() });
        await expectCode(call(useCases), AccessErrorCode.TargetIsOwner, 403);
        expect(acc[applyMethod]).not.toHaveBeenCalled();
        expect(acc.prepareUserPatch).not.toHaveBeenCalled();
        expect(repo.insertRequest).not.toHaveBeenCalled();
    });

    it('reset de senha (middleware) usa a mesma trava', async () => {
        const { useCases } = make({ access: ownerAccount() });
        await expectCode(useCases.assertCanManageUserById(1, MANAGER), AccessErrorCode.TargetIsOwner, 403);
        await expect(useCases.assertCanManageUserById(1, OTHER_OWNER)).resolves.toBeUndefined();
    });

    it('outro dono mexe na conta de um dono normalmente', async () => {
        const { useCases, acc } = make({ access: ownerAccount() });
        await useCases.patchUser(1, { password: 'nova' }, OTHER_OWNER);
        await useCases.deactivateUser(1, OTHER_OWNER);
        expect(acc.applyUserPatch).toHaveBeenCalled();
        expect(acc.deactivateUser).toHaveBeenCalledWith(1, OTHER_OWNER.id);
    });

    it('conta comum continua editável por quem tem ACCESS_MANAGE', async () => {
        const { useCases, acc } = make();
        await useCases.deactivateUser(10, MANAGER);
        expect(acc.deactivateUser).toHaveBeenCalledWith(10, MANAGER.id);
    });
});

describe('AccessRequestUseCases — análise', () => {
    it('aprovar tira de pending e aplica com quem pediu como autor', async () => {
        const { useCases, repo, acc } = make();
        await useCases.approve(55, OWNER);
        expect(repo.claimRequest).toHaveBeenCalledWith(55, AccessRequestStatus.APPROVED, OWNER.id, null);
        expect(acc.assignRolesToUser).toHaveBeenCalledWith(10, [3]);
        expect(repo.claimRequest.mock.invocationCallOrder[0])
            .toBeLessThan(acc.assignRolesToUser.mock.invocationCallOrder[0]);
    });

    it('aprovar criação grava o usuário criado no pedido', async () => {
        const repository = makeFakeRequestRepository({
            findRequestById: jest.fn().mockResolvedValue({
                id: 56, type: AccessRequestType.CREATE_USER, status: 'pending',
                payload: JSON.stringify({ user: 'novo', password: '$2a$10$hash' }), requested_by: MANAGER.id,
            }),
        });
        const { useCases, repo, acc } = make({ repository });
        const out = await useCases.approve(56, OWNER);
        // Pedido antigo, sem as listas: cria só o usuário.
        expect(acc.insertPreparedUser).toHaveBeenCalledWith(
            { user: 'novo', password: '$2a$10$hash' }, MANAGER.id, { roleIds: [], applicationIds: [] });
        expect(repo.setTargetUser).toHaveBeenCalledWith(56, 99);
        expect(out.request.payload.password).toBeUndefined();
        expect(out.request.sets_password).toBe(true);
    });

    it('se aplicar falhar, o pedido volta para pending e o erro sobe', async () => {
        const boom = Object.assign(new Error('dup'), { statusCode: 409 });
        const access = makeFakeAccess({ assignRolesToUser: jest.fn().mockRejectedValue(boom) });
        const { useCases, repo } = make({ access });
        await expect(useCases.approve(55, OWNER)).rejects.toBe(boom);
        expect(repo.releaseRequest).toHaveBeenCalledWith(55);
    });

    it('outro dono já analisou (corrida) → 409, sem aplicar', async () => {
        const repository = makeFakeRequestRepository({ claimRequest: jest.fn().mockResolvedValue(false) });
        const { useCases, acc } = make({ repository });
        await expectCode(useCases.approve(55, OWNER), AccessErrorCode.RequestNotPending, 409);
        expect(acc.assignRolesToUser).not.toHaveBeenCalled();
    });

    it('pedido já recusado → 409', async () => {
        const repository = makeFakeRequestRepository({
            findRequestById: jest.fn().mockResolvedValue({ id: 55, status: 'rejected', requested_by: MANAGER.id }),
        });
        const { useCases } = make({ repository });
        await expectCode(useCases.approve(55, OWNER), AccessErrorCode.RequestNotPending, 409);
    });

    it('ninguém analisa o próprio pedido → 403', async () => {
        const repository = makeFakeRequestRepository({
            findRequestById: jest.fn().mockResolvedValue({ id: 55, status: 'pending', requested_by: OTHER_OWNER.id }),
        });
        const { useCases } = make({ repository });
        await expectCode(useCases.approve(55, OTHER_OWNER), AccessErrorCode.SelfReview, 403);
        await expectCode(useCases.reject(55, OTHER_OWNER), AccessErrorCode.SelfReview, 403);
    });

    it('recusar grava a observação e não aplica', async () => {
        const { useCases, repo, acc } = make();
        await useCases.reject(55, OWNER, 'sem justificativa');
        expect(repo.claimRequest).toHaveBeenCalledWith(55, AccessRequestStatus.REJECTED, OWNER.id, 'sem justificativa');
        expect(acc.assignRolesToUser).not.toHaveBeenCalled();
    });

    it('só quem pediu cancela', async () => {
        const { useCases, repo } = make();
        await expectCode(useCases.cancel(55, { id: 8, permissions: ['ACCESS_MANAGE'] }), AccessErrorCode.NotRequester, 403);
        await useCases.cancel(55, MANAGER);
        expect(repo.claimRequest).toHaveBeenCalledWith(55, AccessRequestStatus.CANCELED, MANAGER.id, null);
    });

    it('pedido inexistente → 404', async () => {
        const repository = makeFakeRequestRepository({ findRequestById: jest.fn().mockResolvedValue(null) });
        const { useCases } = make({ repository });
        await expectCode(useCases.approve(1, OWNER), AccessErrorCode.RequestNotFound, 404);
    });
});

describe('AccessRequestUseCases — avisos e sino', () => {
    it('pedido novo avisa os donos, não quem pediu', async () => {
        const { useCases, pub } = make();
        await useCases.assignRolesToUser(10, [3], MANAGER);
        expect(pub.publish).toHaveBeenCalledTimes(1);
        const [ids, payload] = pub.publish.mock.calls[0];
        expect(ids).toEqual([OWNER.id, OTHER_OWNER.id]);
        expect(payload.action).toBe('requested');
        expect(payload.request.id).toBe(55);
    });

    it('dono aplicando direto não avisa ninguém', async () => {
        const { useCases, pub } = make();
        await useCases.assignRolesToUser(10, [3], OWNER);
        expect(pub.publish).not.toHaveBeenCalled();
    });

    it('aprovar e recusar avisam os donos e quem pediu', async () => {
        const { useCases, pub } = make();
        await useCases.approve(55, OWNER);
        await useCases.reject(55, OWNER, 'não');
        expect(pub.publish.mock.calls.map(c => c[1].action)).toEqual(['approved', 'rejected']);
        for (const [ids] of pub.publish.mock.calls) {
            expect(ids).toEqual([OWNER.id, OTHER_OWNER.id, MANAGER.id]);
        }
    });

    it('cancelar avisa só os donos', async () => {
        const { useCases, pub } = make();
        await useCases.cancel(55, MANAGER);
        expect(pub.publish).toHaveBeenCalledWith([OWNER.id, OTHER_OWNER.id], expect.objectContaining({ action: 'canceled' }));
    });

    it('falha ao avisar não derruba o pedido', async () => {
        const repository = makeFakeRequestRepository({ findApproverIds: jest.fn().mockRejectedValue(new Error('db')) });
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { useCases } = make({ repository });
        const out = await useCases.assignRolesToUser(10, [3], MANAGER);
        expect(out.pending).toBe(true);
        spy.mockRestore();
    });

    it('summary soma os pendentes por tipo e traz os mais recentes sem senha', async () => {
        const repository = makeFakeRequestRepository({
            countPendingByType: jest.fn().mockResolvedValue({ create_user: 2, assign_user_roles: 1 }),
            findRequests: jest.fn().mockResolvedValue({
                rows: [{ id: 9, type: 'create_user', payload: { user: 'novo', password: 'h' } }], total: 3,
            }),
        });
        const { useCases, repo } = make({ repository });
        const out = await useCases.summary();
        expect(out.pending_total).toBe(3);
        expect(out.pending_by_type).toEqual({ create_user: 2, assign_user_roles: 1 });
        expect(out.latest[0].payload).toEqual({ user: 'novo' });
        expect(repo.findRequests.mock.calls[0][0].status).toBe('pending');
        expect(repo.findRequests.mock.calls[0][1]).toEqual({ limit: 5, offset: 0 });
    });
});

describe('AccessRequestUseCases — listagem', () => {
    it('padrão é pending; status=all tira o filtro', async () => {
        const { useCases, repo } = make();
        await useCases.list({});
        expect(repo.findRequests.mock.calls[0][0].status).toBe('pending');
        await useCases.list({ status: 'all' });
        expect(repo.findRequests.mock.calls[1][0].status).toBeNull();
    });

    it('status ou tipo desconhecido → 400', async () => {
        const { useCases } = make();
        await expectCode(useCases.list({ status: 'xyz' }), AccessErrorCode.InvalidRequestStatus, 400);
        await expectCode(useCases.list({ type: 'xyz' }), AccessErrorCode.InvalidRequestType, 400);
    });

    it('nunca devolve o hash da senha', async () => {
        const repository = makeFakeRequestRepository({
            findRequests: jest.fn().mockResolvedValue({
                rows: [{ id: 1, payload: { user: 'novo', password: '$2a$10$hash' } }], total: 1,
            }),
        });
        const { useCases } = make({ repository });
        const page = await useCases.list({});
        expect(page.items[0].payload).toEqual({ user: 'novo' });
        expect(page.pagination.total).toBe(1);
    });
});
