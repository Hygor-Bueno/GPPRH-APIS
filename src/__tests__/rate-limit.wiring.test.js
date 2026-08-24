/**
 * Exercita a cadeia real montada por `app.factory` — não os keyGenerators
 * isolados.
 *
 * Existe porque o `express-rate-limit` roda as validações dele na PRIMEIRA
 * requisição, não na construção do middleware: um `keyGenerator` customizado
 * que ele considere inseguro (IPv6 não tratado, `trust proxy` permissivo)
 * derruba a rota em produção sem que teste de unidade nenhum perceba.
 *
 * ⚠️ Os limiters são singletons de módulo e compartilham um `MemoryStore` por
 * processo — `buildApp()` monta um app novo, mas reaproveita os mesmos
 * contadores. Por isso cada teste usa ids de usuário próprios (`freshId()`) em
 * vez de assumir contador zerado.
 */

const express = require('express');
const request = require('supertest');

const { createApp } = require('../app.factory');
const jwtService = require('../infra/auth/jwt.service');
const { LIMITS } = require('../middlewares/rate-limit.middleware');

function buildApp() {
    const router = express.Router();
    router.get('/ping', (req, res) => res.json({ ok: true }));

    return createApp({ allowedOrigins: ['http://localhost:3000'], routes: [{ prefix: '/t', router }] });
}

let lastId = 9000;
const freshId = () => ++lastId;

const cookieFor = id => `accessToken=${jwtService.generateAccessToken({ id, name: 'Fulano' })}`;

const remaining = res => Number(res.headers['ratelimit'].match(/remaining=(\d+)/)[1]);

describe('cadeia de rate limiting montada pelo app.factory', () => {
    it('requisição anônima passa e é contada no balde de IP', async () => {
        const res = await request(buildApp()).get('/t/ping');

        expect(res.status).toBe(200);
        expect(res.headers['ratelimit-policy']).toContain(String(LIMITS.ip));
    });

    it('requisição autenticada é contada no balde de usuário', async () => {
        const res = await request(buildApp())
            .get('/t/ping')
            .set('Cookie', cookieFor(freshId()));

        expect(res.status).toBe(200);
        // A política que aparece é a do limiter que efetivamente contou —
        // prova que o `skip` mandou a requisição para a camada certa.
        expect(res.headers['ratelimit-policy']).toContain(String(LIMITS.user));
    });

    it('dois usuários no mesmo IP não dividem contador', async () => {
        const app = buildApp();

        const primeiro = await request(app).get('/t/ping').set('Cookie', cookieFor(freshId()));
        const segundo = await request(app).get('/t/ping').set('Cookie', cookieFor(freshId()));

        // Se o balde fosse compartilhado, o segundo veria uma unidade menos.
        expect(remaining(primeiro)).toBe(LIMITS.user - 1);
        expect(remaining(segundo)).toBe(LIMITS.user - 1);
    });

    it('o mesmo usuário consome o próprio contador', async () => {
        const app = buildApp();
        const cookie = cookieFor(freshId());

        await request(app).get('/t/ping').set('Cookie', cookie);
        const segundo = await request(app).get('/t/ping').set('Cookie', cookie);

        expect(remaining(segundo)).toBe(LIMITS.user - 2);
    });

    it('quem estoura a cota recebe 429 identificável e não derruba os demais', async () => {
        const app = buildApp();
        const barrado = cookieFor(freshId());

        for (let i = 0; i < LIMITS.user; i++) {
            await request(app).get('/t/ping').set('Cookie', barrado);
        }

        const res = await request(app).get('/t/ping').set('Cookie', barrado);

        expect(res.status).toBe(429);
        expect(res.body.message).toBe('Too many attempts. Please try again in a few minutes.');
        expect(res.body.code).toBe('RATE_LIMIT_USER');
        expect(res.body.retry_after_seconds).toBeGreaterThan(0);
        expect(Number.isNaN(res.body.retry_after_seconds)).toBe(false);

        // É este o comportamento que o relato de 24/08/2026 pedia: o teto de um
        // usuário não pode responder 429 para os outros, nem para o anônimo.
        expect((await request(app).get('/t/ping').set('Cookie', cookieFor(freshId()))).status).toBe(200);
        expect((await request(app).get('/t/ping')).status).toBe(200);
    }, 60000);
});
