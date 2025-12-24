const authService = require("../services/AuthService");
const { parseTime } = require("../utils/timeParser");

module.exports = (req, res, next) => {
    const accessToken = req.cookies.accessToken;
    const refreshToken = req.cookies.refreshToken;

    // 1️⃣ Nenhum token
    if (!accessToken && !refreshToken) {
        return res.status(401).json({ error: true, message: "Authentication required" });
    }

    // 2️⃣ Access token válido
    if (accessToken) {
        try {
            req.user = authService.verifyAccessToken(accessToken);
            return next();
        } catch (err) {
            if (err.name !== "TokenExpiredError") {
                return res.status(401).json({ error: true, message: "Invalid access token" });
            }
            // expirou → tenta refresh
        }
    }

    // 3️⃣ Refresh obrigatório
    if (!refreshToken) {
        return res.status(401).json({ error: true, message: "Session expired" });
    }

    try {
        const { accessToken: newAccess, user } = authService.refreshAccessToken(refreshToken);

        const isProd = process.env.NODE_ENV === 'production';

        res.cookie('accessToken', newAccess, {
            httpOnly: true,
            sameSite: isProd ? 'none' : 'lax',
            secure: isProd,
            maxAge: parseTime(process.env.COOKIE_MAX_AGE_ACCESS),
            path: '/'
        });

        req.user = user;
        return next();

    } catch {
        return res.status(401).json({
            error: true,
            message: "Invalid or expired refresh token"
        });
    }
};
