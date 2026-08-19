const authService = require('../../../infra/auth/jwt.service.js');
const { BadRequestError } = require("../../../errors/bad-request.error.js");
const { UnauthorizedError } = require('../../../errors/unauthorized.error.js');
const { parseTime } = require('../../../utils/time-parser.js');
const { respond } = require('../../../utils/respond');
const { AuthUseCases } = require('../application/auth/auth.use-cases');
const { MysqlAuthRepository } = require('../infrastructure/auth/mysql-auth.repository');
const { SqlServerProtheusEmployeeRepository } = require('../infrastructure/auth/sqlserver-protheus-employee.repository');
const { LdapAuthenticatorAdapter } = require('../infrastructure/auth/ldap-authenticator.adapter');

const useCases = new AuthUseCases({
  repository: new MysqlAuthRepository(),
  protheusRepository: new SqlServerProtheusEmployeeRepository(),
  ldapAuthenticator: new LdapAuthenticatorAdapter(),
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

  const user = await useCases.login(cleanUsername, password);

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
    // `application_ids` diz quais telas o usuário enxerga; `permissions` diz o
    // que ele pode fazer. São eixos independentes — os middlewares canAny/canAll
    // avaliam apenas `permissions`, então o front não consegue deduzir o acesso
    // a uma rota a partir do id da aplicação. Ambos já vinham no token; só não
    // eram devolvidos aqui.
    roles:                    u.roles ?? [],
    permissions:              u.permissions ?? [],
    // O must-change-password.middleware libera o /me justamente para o front
    // descobrir a pendência aqui. Sem este campo, a única forma de saber era
    // tomar 403 com code MUST_CHANGE_PASSWORD em outra rota.
    must_change_password:     Boolean(u.must_change_password),
    company_name:             u.company_name,
    branch_name:              u.branch_name,
    cost_center_description:  u.cost_center_description
  });
};

/**
 * PUT /change-password
 * Body: { current_password, new_password }
 *
 * O usuário vem sempre do token (`req.user.id`). Depois de trocar, a sessão é
 * encerrada: os cookies atuais foram emitidos com a senha antiga, e forçar novo
 * login é o que garante que uma sessão roubada não sobreviva à troca.
 */
async function changePassword(req, res) {
  const { current_password, new_password } = req.body;

  await useCases.changeOwnPassword(req.user.id, current_password, new_password);

  res.clearCookie('accessToken', cookieOpts());
  res.clearCookie('refreshToken', cookieOpts());

  return respond.message(res, 'Senha alterada com sucesso. Faça login novamente.');
};

/**
 * POST /access/users/:id/reset-password
 *
 * Reset feito pela gestão de acessos. Gera uma senha temporária aleatória e
 * marca o usuário para trocar no próximo acesso.
 *
 * ⚠️ `temporary_password` vem em claro e aparece UMA ÚNICA VEZ — não é gravada
 * em lugar nenhum além do hash. Se a tela perder o valor, o caminho é resetar
 * de novo. Não registre esta resposta em log.
 */
async function resetUserPassword(req, res) {
  const targetUserId = Number(req.params.id);

  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw new BadRequestError('Informe um id de usuário válido.');
  }

  const data = await useCases.resetUserPassword(targetUserId);

  return respond.ok(res, {
    ...data,
    message: 'Senha resetada. Entregue a senha temporária ao usuário — ela não será exibida novamente.',
  });
};

async function logout(req, res) {
  res.clearCookie('accessToken', cookieOpts());
  res.clearCookie('refreshToken', cookieOpts());
  return respond.message(res, 'Sessão encerrada com sucesso.');
};


module.exports = {
  me,
  resetUserPassword,
  logout,
  changePassword,
  globalLogin
};
