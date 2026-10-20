/**
 * @fileoverview Autenticação OPCIONAL por cookie, para rota pública que muda a
 * resposta conforme quem consulta (ex.: agenda da reserva de espaços).
 *
 * Com sessão válida, `req.user` fica preenchido exatamente como no
 * `auth.middleware` — inclusive renovando o `accessToken` pelo refresh. Sem
 * sessão, com sessão inválida/expirada, usuário inativo ou com troca de senha
 * pendente, segue como ANÔNIMO (`req.user = null`) e NUNCA responde erro: a
 * rota é pública, e um cookie velho não pode transformar "ver a agenda" em 401.
 *
 * ⚠️ Não substitui o `auth.middleware` em rota que exige login, e não lê
 * `Authorization: Bearer` — a sessão desta API é só cookie (ver `CLAUDE.md`).
 * O `auth.middleware` fica intocado; este arquivo só reaproveita o mesmo
 * `authenticateFromCookies`.
 *
 * Troca de senha pendente vira anônimo (e não 403) de propósito: o
 * `must-change-password.middleware` barra tudo que não seja /me, /logout e
 * /change-password, e uma rota pública não deve dar a quem está com senha
 * temporária mais do que daria a um visitante.
 *
 * @module middlewares/optional-auth.middleware
 */

const { authenticateFromCookies } = require('../application/auth/auth-session.service.js');
const { parseTime } = require('../utils/time-parser.js');

async function optionalAuth(req, res, next) {
    req.user = null;

    const cookies = req.cookies || {};
    if (!cookies.accessToken && !cookies.refreshToken) return next();

    try {
        const { user, newAccessToken } = await authenticateFromCookies(cookies);

        // Mesmo cookie que o auth.middleware grava ao renovar — sem isso o
        // próximo request autenticado renovaria de novo, à toa.
        if (newAccessToken) {
            const isProd = process.env.NODE_ENV === 'production';
            res.cookie('accessToken', newAccessToken, {
                httpOnly: true,
                sameSite: isProd ? 'none' : 'lax',
                secure: isProd,
                maxAge: parseTime(process.env.COOKIE_MAX_AGE_ACCESS),
                path: '/',
            });
        }

        const inactive = user.status !== undefined && user.status !== 'active';
        if (!inactive && !user.must_change_password) req.user = user;
    } catch {
        // Sessão inválida ou expirada: anônimo, sem erro.
    }

    return next();
}

module.exports = { optionalAuth };
