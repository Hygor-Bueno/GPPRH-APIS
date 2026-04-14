// authHelper.js
const authService = require("../../infra/auth/jwt.service.js");

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
        const { accessToken: newAccess, user } =
            authService.refreshAccessToken(refreshToken);

        return { user, newAccessToken: newAccess };

    } catch {
        throw new Error("Invalid or expired refresh token");
    }
}

module.exports = { authenticateFromCookies };