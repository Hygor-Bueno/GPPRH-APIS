// authHelper.js
const authService = require("../../infra/auth/jwt.service.js");
const { AccessService } = require("../../modules/global/services/access.service.js");

async function authenticateFromCookies(cookies) {
    const accessToken = cookies.accessToken;
    const refreshToken = cookies.refreshToken;

    // 1️⃣ Nenhum token
    if (!accessToken && !refreshToken) {
        throw new Error("Authentication required");
    }

    // 2️⃣ Access token válido
    if (accessToken) {
        try {
            const user = authService.verifyAccessToken(accessToken);
            console.log(`✅ Access token válido para userId=${user.id}`);
            return { user, newAccessToken: null };
        } catch (err) {
            if (err.name !== "TokenExpiredError") {
                throw new Error("Invalid access token");
            }
            // expirou → tenta refresh
        }
    }

    // 3️⃣ Refresh obrigatório
    if (!refreshToken) {
        throw new Error("Session expired");
    }

    try {
        const decoded = authService.verifyRefreshToken(refreshToken);

        // remove claims automáticas
        const { iat, exp, nbf, jti, aud, iss, ...payload } = decoded;

        // Sessões do módulo global carregam `status` (= ad_status) no token.
        // A cada refresh, revalida status/roles/permissões no banco — assim um
        // bloqueio feito em access/users se reflete no próximo access token,
        // em vez de só quando o refresh token expirar por completo.
        if (payload.status !== undefined) {
            const fresh = await new AccessService().getUserById(payload.id);
            payload.status      = fresh.ad_status;
            payload.roles       = fresh.roles       ? fresh.roles.split(',')       : [];
            payload.permissions = fresh.permissions  ? fresh.permissions.split(',') : [];
        }

        const newAccessToken = authService.generateAccessToken(payload);

        return { user: payload, newAccessToken };

    } catch {
        throw new Error("Invalid or expired refresh token");
    }
}

module.exports = { authenticateFromCookies };