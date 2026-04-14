const JwtService = require('../../../infra/auth/jwt.service.js');
const bcrypt = require("bcrypt");
const { parseTime } = require('../../../utils/time-parser.js');
const { GoogleAuthService } = require('../providers/google-auth.service.js');
const { User } = require('../domain/user.entity');
const LDAPAuthenticator = require('../../../infra/auth/ldap-auth.service');
const { GpprhService } = require('../services/gpprh.service.js');
const { UnauthorizedError } = require('../../../errors/unauthorized.error.js');
const { BadRequestError } = require('../../../errors/bad-request.error.js');
const { AppError } = require('../../../errors/app.error.js');

const isProd = process.env.NODE_ENV === 'production';

const cookieOpts = maxAge => ({
  httpOnly: true,
  sameSite: isProd ? 'none' : 'lax',
  secure: isProd,
  path: '/',
  ...(maxAge && { maxAge: parseTime(maxAge) })
});

async function createSession(res, payload) {
  res.cookie(
    'accessToken',
    JwtService.generateAccessToken(payload),
    cookieOpts(process.env.COOKIE_MAX_AGE_ACCESS)
  );

  res.cookie(
    'refreshToken',
    JwtService.generateRefreshToken(payload),
    cookieOpts(process.env.COOKIE_MAX_AGE_REFRESH)
  );

  const roles = Array.isArray(payload.roles)
    ? payload.roles.join(',')
    : payload.roles;

  res.cookie(
    'userRole',
    roles,
    cookieOpts(process.env.COOKIE_MAX_AGE_ACCESS)
  );
}

const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    throw new BadRequestError('Username and password are required');
  }

  const auth = await new LDAPAuthenticator(
    username,
    password
  ).authenticateUser(username, password);

  const service = new GpprhService(auth.guid);

  await service.spAdLogin(auth.name);

  const payload = await service.getUser();

  await createSession(res, payload);

  return res.json({
    error: false,
    data: new User(payload)
  });
};

const me = (req, res) => {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated');
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

const googleLogin = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new BadRequestError('Authorization header not found');
  }

  const [, credential] = authHeader.split(' ');

  if (!credential) {
    throw new BadRequestError('Google credential not found');
  }

  const payload = await GoogleAuthService.login(credential);

  if (!payload?.email) {
    throw new AppError(
      'Invalid Google payload',
      401,
      { code: 'GOOGLE_AUTH_INVALID' }
    );
  }

  const service = new GpprhService(payload.email);

  const user = await service.spCandidateLogin(
    payload.name,
    payload.email
  );

  user.roles = 'CANDIDATE';
  user.permissions = 'CANDIDATE';
  await createSession(res, user);

  return res.json({
    error: false,
    message: 'Success login'
  });
};
const logout = (req, res) => {
  res.clearCookie('accessToken', cookieOpts());
  res.clearCookie('refreshToken', cookieOpts());

  return res.json({
    error: false,
    message: 'Logged out successfully'
  });
};

module.exports = {
  login,
  me,
  logout,
  googleLogin
};