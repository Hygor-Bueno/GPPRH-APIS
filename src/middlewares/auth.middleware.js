const { authenticateFromCookies } = require("../application/auth/auth-session.service.js");
const { parseTime } = require("../utils/time-parser.js");

module.exports = async (req, res, next) => {
  try {
    const { user, newAccessToken } = await authenticateFromCookies(req.cookies);

    // se gerou novo access token → seta cookie
    if (newAccessToken) {
      const isProd = process.env.NODE_ENV === 'production';

      res.cookie('accessToken', newAccessToken, {
        httpOnly: true,
        sameSite: isProd ? 'none' : 'lax',
        secure: isProd,
        maxAge: parseTime(process.env.COOKIE_MAX_AGE_ACCESS),
        path: '/'
      });
    }

    req.user = user;
    next();

  } catch (err) {
    return res.status(401).json({
      error: true,
      message: err.message
    });
  }
};