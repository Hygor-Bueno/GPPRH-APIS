const authService = require('../../../infra/auth/jwt.service.js');
const { notifyUserLogin } = require('../../../websocket/events/notification.event.js');
const { BadRequestError } = require("../../../errors/bad-request.error.js");
const { GlobalService } = require("../services/auth.service.js");
const { parseTime } = require('../../../utils/time-parser.js');
const { UnauthorizedError } = require('../../../errors/unauthorized.error.js');
const { User } = require('../domain/user.entity');

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

  const service = new GlobalService();
  const payload = await service.controlleLogin(username, password);
  const user = await service.getGlobalUserForGuid(payload.guid || payload.id);
  
  await createSession(res, user);

  notifyUserLogin(user).catch(() => {}); // fire-and-forget — WebSocket notification, non-critical
  return res.json({
    error: false,
    message: "Success in login" // new User(payload)
  });
};

async function me(req, res) {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated');
  }

  const user = new User(req.user);
  const payload = {
    id: user.id,
    nickname: user.nickname,
    registration: user.registration,
    status: user.ad_status,
    application_ids: user.application_ids,
    company_name: user.company_name,
    branch_name: user.branch_name,
    cost_center_description: user.cost_center_description
  }

  return res.json({
    error: false,
    data: payload
  });
};

async function logout(req, res) {
  res.clearCookie('accessToken', cookieOpts());
  res.clearCookie('refreshToken', cookieOpts());

  return res.json({
    error: false,
    message: 'Logged out successfully'
  });
};


module.exports = {
  me,
  logout,
  globalLogin
};