/**
 * O `/me` passou a resolver o `file_id` da foto do usuário no banco.
 *
 * O que estes testes protegem é a parte não óbvia: a rota é o que inicializa a
 * sessão no front, então uma falha ao buscar a foto — decoração — não pode
 * impedir a resposta. Antes desta mudança o `/me` não fazia consulta nenhuma;
 * a partir dela faz, e é aí que mora o risco de regressão.
 *
 * Os adapters são dublados porque `config/protheus` e `config/sqlserver` abrem
 * ConnectionPool no import: sem os mocks, só carregar o controller já tentaria
 * falar com 10.10.10.51.
 */

const express = require('express');
const request = require('supertest');

const mockGetPhotoFileId = jest.fn();

jest.mock('../../application/auth/auth.use-cases', () => ({
    AuthUseCases: jest.fn(() => ({ getPhotoFileId: mockGetPhotoFileId })),
}));
jest.mock('../../infrastructure/auth/mysql-auth.repository', () => ({ MysqlAuthRepository: jest.fn() }));
jest.mock('../../infrastructure/auth/sqlserver-protheus-employee.repository', () => ({
    SqlServerProtheusEmployeeRepository: jest.fn(),
}));
jest.mock('../../infrastructure/auth/ldap-authenticator.adapter', () => ({
    LdapAuthenticatorAdapter: jest.fn(),
}));

const authController = require('../auth.controller');

const USER = Object.freeze({
    id: 397,
    nickname: 'Berenildo Lino',
    registration: '002351',
    status: 'active',
    application_ids: [1, 2],
    roles: ['ENCARREGADO'],
    permissions: ['GIPP_CREATE_TIMERECORD'],
    must_change_password: 0,
    company_name: 'Pegpese',
    branch_name: 'Interlagos',
    cost_center_description: 'Loja',
});

/** App mínimo com o usuário já autenticado, como o authMiddleware deixaria. */
function buildApp(user = USER) {
    const app = express();
    app.get('/me', (req, res, next) => {
        req.user = user;
        authController.me(req, res).catch(next);
    });
    return app;
}

beforeEach(() => {
    mockGetPhotoFileId.mockReset();
});

describe('GET /me — file_id da foto', () => {
    it('devolve o file_id do usuário da sessão', async () => {
        mockGetPhotoFileId.mockResolvedValue(1842);

        const res = await request(buildApp()).get('/me');

        expect(res.status).toBe(200);
        expect(res.body.data.file_id).toBe(1842);
        expect(mockGetPhotoFileId).toHaveBeenCalledWith(397);
    });

    it('devolve null quando o usuário não tem foto', async () => {
        mockGetPhotoFileId.mockResolvedValue(null);

        const res = await request(buildApp()).get('/me');

        expect(res.status).toBe(200);
        expect(res.body.data.file_id).toBeNull();
    });

    it('responde normalmente mesmo se a consulta da foto falhar', async () => {
        // O caso que importa: MySQL indisponível não pode impedir o app de abrir.
        mockGetPhotoFileId.mockRejectedValue(new Error('pool esgotado'));

        const res = await request(buildApp()).get('/me');

        expect(res.status).toBe(200);
        expect(res.body.data.file_id).toBeNull();
        // E o resto da identidade continua íntegro.
        expect(res.body.data.id).toBe(397);
        expect(res.body.data.permissions).toEqual(['GIPP_CREATE_TIMERECORD']);
    });

    it('não perde nenhum campo que a rota já devolvia', async () => {
        mockGetPhotoFileId.mockResolvedValue(null);

        const { body } = await request(buildApp()).get('/me');

        expect(Object.keys(body.data).sort()).toEqual([
            'application_ids', 'branch_name', 'company_name', 'cost_center_description',
            'file_id', 'id', 'must_change_password', 'nickname', 'permissions',
            'registration', 'roles', 'status',
        ]);
    });

    it('recusa requisição sem usuário', async () => {
        const app = express();
        app.get('/me', (req, res, next) => authController.me(req, res).catch(next));

        const res = await request(app).get('/me');

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(mockGetPhotoFileId).not.toHaveBeenCalled();
    });
});
