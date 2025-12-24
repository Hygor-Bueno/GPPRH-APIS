const jwt = require("jsonwebtoken");

class AuthService {
    generateAccessToken(payload) {
        return jwt.sign(
            payload,
            process.env.JWT_ACCESS_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_ACCESS_IN }
        );
    }

    generateRefreshToken(payload) {
        return jwt.sign(
            payload,
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_REFRESH_IN }
        );
    }

    verifyAccessToken(token) {
        return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    }

    verifyRefreshToken(token) {
        return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    }

    refreshAccessToken(refreshToken) {
        const decoded = this.verifyRefreshToken(refreshToken);

        // remove claims automáticas
        const { iat, exp, nbf, jti, aud, iss, ...payload } = decoded;

        const newAccessToken = this.generateAccessToken(payload);

        return {
            accessToken: newAccessToken,
            user: payload
        };
    }
}

module.exports = new AuthService();
