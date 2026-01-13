const authService = require('../../../services/AuthService.js');
const { parseTime } = require('../../../utils/timeParser.js');
const { GoogleAuthService } = require('../provider/GoogleAuthService.js');
const { GpprgService } = require('../services/GpprgService.js');
const { User } = require('../domain/User.js');
const LDAPAuthenticator = require('../provider/LDAPAuthenticator.js');

const isProd = process.env.NODE_ENV === 'production';
// Opções padronizadas de cookie para evitar divergência entre set/clear
const cookieOpts = maxAge => ({
  httpOnly: true,
  sameSite: isProd ? 'none' : 'lax', // necessário para frontend separado
  secure: isProd,
  path: '/',
  ...(maxAge && { maxAge: parseTime(maxAge) })
});

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Autenticação no AD (fonte oficial do usuário)LDAPAuthenticator
    const auth = await new LDAPAuthenticator(username, password).authenticateUser(username, password);
    const service = new GpprgService(auth.guid);

    // Cria ou valida usuário no GPP-RH
    await service.spAdLogin(auth.name);

    const payload = await service.getUser();
    res.cookie('accessToken',
      authService.generateAccessToken(payload),
      cookieOpts(process.env.COOKIE_MAX_AGE_ACCESS)
    );

    res.cookie('refreshToken',
      authService.generateRefreshToken(payload),
      cookieOpts(process.env.COOKIE_MAX_AGE_REFRESH)
    );

    // 🔹 Grava role em cookie separado
    const roles = Array.isArray(payload.roles) ? payload.roles.join(",") : payload.roles;
    res.cookie('userRole', roles, cookieOpts(process.env.COOKIE_MAX_AGE_ACCESS));

    res.json({ error: false, data: new User(payload) });
  } catch (err) {
    res.status(401).json({ error: true, message: err.message || 'Authentication failed' });
  }
};

const me = (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: true, message: 'Not authenticated' });
  }

  const user = new User(req.user);

  return res.json({
    error: false,
    data: {
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      candidate: user.candidate,
    },
  });
};


const googleLogin = async (req, res) =>
  req.body.credential
    ? res.json({ error: false, data: await GoogleAuthService.login(req.body.credential) })
    : res.status(400).json({ error: true, message: 'Credential failed' });

const logout = (req, res) => {
  res.clearCookie('accessToken', cookieOpts());
  res.clearCookie('refreshToken', cookieOpts());
  res.json({ error: false, message: 'Logged out successfully' });
};

module.exports = { login, me, logout, googleLogin };