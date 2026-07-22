const authService = require('../../../infra/auth/jwt.service.js');
const { BadRequestError } = require("../../../errors/bad-request.error.js");
const { GlobalService } = require("../services/auth.service.js");
const { parseTime } = require('../../../utils/time-parser.js');
const { UnauthorizedError } = require('../../../errors/unauthorized.error.js');
const { respond } = require('../../../utils/respond');

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
    authService.generateAccessToken(payload),
    cookieOpts(process.env.COOKIE_MAX_AGE_ACCESS)
  );

  res.cookie(
    'refreshToken',
    authService.generateRefreshToken(payload),
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

async function globalLogin(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    throw new BadRequestError('Username and password are required');
  }

  // Remove espaços do início e fim — autocomplete mobile pode inserir espaços
  const cleanUsername = username.trim();

  const service = new GlobalService();
  const payload = await service.controlleLogin(cleanUsername, password);
  const user = await service.getGlobalUserForGuid(payload.guid || payload.id);

  await createSession(res, user);

  return respond.message(res, 'Logged in successfully');
};

async function me(req, res) {
  if (!req.user) throw new UnauthorizedError('Not authenticated');

  const u = req.user;
  return respond.ok(res, {
    id:                       u.id,
    nickname:                 u.nickname,
    registration:             u.registration,
    status:                   u.status,
    application_ids:          u.application_ids,
    company_name:             u.company_name,
    branch_name:              u.branch_name,
    cost_center_description:  u.cost_center_description
  });
};

async function logout(req, res) {
  res.clearCookie('accessToken', cookieOpts());
  res.clearCookie('refreshToken', cookieOpts());
  return respond.message(res, 'Logged out successfully');
};


module.exports = {
  me,
  logout,
  globalLogin
};