const JwtService = require('../../../infra/auth/jwt.service.js');
const { parseTime } = require('../../../utils/time-parser.js');
const { User } = require('../domain/user.entity');
const { UnauthorizedError } = require('../../../errors/unauthorized.error.js');
const { BadRequestError } = require('../../../errors/bad-request.error.js');
const { respond } = require('../../../utils/respond.js');
const { GpprhLoginUseCases } = require('../application/gpprh-login.use-cases');
const { MysqlGpprhRepository } = require('../infrastructure/mysql-gpprh.repository');
const { GoogleTokenVerifierAdapter } = require('../infrastructure/google-token-verifier.adapter');
const { LdapAuthenticatorAdapter } = require('../infrastructure/ldap-authenticator.adapter');

const useCases = new GpprhLoginUseCases({
  repository: new MysqlGpprhRepository(),
  ldapAuthenticator: new LdapAuthenticatorAdapter(),
  googleTokenVerifier: new GoogleTokenVerifierAdapter(),
});

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

  const payload = await useCases.loginViaAd(username, password);

  await createSession(res, payload);

  return respond.ok(res, new User(payload));
};

const me = (req, res) => {
  if (!req.user) throw new UnauthorizedError('Not authenticated');
  const user = new User(req.user);
  return respond.ok(res, {
    user_id: user.user_id,
    name: user.name,
    email: user.email,
    candidate: user.candidate,
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

  const user = await useCases.loginViaGoogle(credential);

  await createSession(res, user);

  return respond.message(res, 'Logged in successfully');
};
const logout = (req, res) => {
  res.clearCookie('accessToken', cookieOpts());
  res.clearCookie('refreshToken', cookieOpts());
  return respond.message(res, 'Logged out successfully');
};

module.exports = {
  login,
  me,
  logout,
  googleLogin
};