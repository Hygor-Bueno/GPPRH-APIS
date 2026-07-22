const jwt = require("jsonwebtoken");
require('dotenv').config();

class JwtService {
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
}

module.exports = new JwtService();
