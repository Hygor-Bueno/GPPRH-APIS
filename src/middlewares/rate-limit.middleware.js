/**
 * @fileoverview Rate limiting.
 *
 * ─── O problema que esta versão corrige (24/08/2026) ─────────────────────────
 *
 * Antes, os três limiters usavam o `keyGenerator` default do
 * `express-rate-limit`, que é `req.ip`. Consequências medidas em produção:
 *
 *  - O `apiLimiter` global dava 200 requisições por IP a cada 15 min contando
 *    TUDO (não só falhas). Uma estação em uso normal chegava ao teto sozinha —
 *    numa amostragem, 42 das 200 já estavam consumidas em poucos minutos de
 *    janela. A rota de fotos (`/global/files/:id`) passa pelo limiter, então
 *    uma tela com 20 fotos custa 20 requisições.
 *  - Usuários atrás de um mesmo IP (app mobile no NAT corporativo, terminal
 *    compartilhado) dividiam o MESMO balde: o uso de um derrubava os outros.
 *  - No login, 10 senhas erradas de uma pessoa travavam o login de todos que
 *    saíam pelo mesmo IP.
 *
 * A chave agora é o USUÁRIO AUTENTICADO onde há sessão, e o IP só onde não há.
 * As duas camadas são mutuamente exclusivas (ver `skip` de cada uma), então
 * ninguém é contado duas vezes.
 *
 * ─── O que NÃO era o problema ────────────────────────────────────────────────
 *
 * `trust proxy` está correto. Verificado em 24/08/2026 mandando um
 * `X-Forwarded-For` forjado de fora: o balde não mudou, ou seja, o Apache
 * acrescenta o IP real ao final do header e o Express pega esse valor. O
 * limiter também não é burlável pelo cliente. Não mexa nisso.
 *
 * ─── Limitação conhecida: o contador é por processo ──────────────────────────
 *
 * O store é em memória e o `pm2-runtime` roda 2 instâncias em cluster, cada uma
 * com o próprio contador. Efeitos: o limite real fica entre 1x e 2x o
 * configurado, dependendo de como as requisições se distribuem, e o
 * `RateLimit-Remaining` oscila de forma não monotônica entre respostas (medido:
 * 158 → 164 → 157 na mesma janela). Resolver de verdade exige store
 * compartilhado (Redis), que não está na stack — os limites abaixo foram
 * escolhidos com folga suficiente para essa imprecisão não importar.
 *
 * @module middlewares/rate-limit.middleware
 */

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const jwtService = require('../infra/auth/jwt.service');

/** Janela comum a todos os limiters. */
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Cotas por janela. Exportadas para que o teste verifique os números sem
 * depender de introspecção — o objeto devolvido por `rateLimit()` é uma função
 * de middleware e não expõe as opções recebidas.
 */
const LIMITS = Object.freeze({
    /** Tráfego sem sessão, por IP. */
    ip: 2000,
    /** Tráfego com sessão, por usuário. */
    user: 1000,
    /** Falhas de login, por IP + usuário tentado. */
    login: 10,
    /** Falhas de login, teto por IP. */
    loginIp: 50,
    /** Falhas de troca de senha, por usuário. */
    changePassword: 5,
});

/**
 * Chave por IP, tolerante a IPv6.
 *
 * `ipKeyGenerator` agrupa endereços IPv6 por prefixo em vez de tratar cada
 * endereço como um cliente distinto — sem isso, quem tem IPv6 rotativo
 * escaparia do limite trocando de endereço dentro da própria faixa.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function ipKey(req) {
    return ipKeyGenerator(req.ip);
}

/**
 * Id do usuário autenticado, ou `null`.
 *
 * O token é **verificado**, não apenas decodificado. Confiar no conteúdo sem
 * verificar deixaria o limite por usuário ser burlado: bastaria inventar um id
 * diferente a cada requisição para ganhar um balde novo. Token inválido ou
 * expirado cai no caminho anônimo, que é limitado por IP.
 *
 * O resultado fica memoizado na requisição porque duas camadas de limiter
 * consultam o mesmo valor — e o `authMiddleware` vai verificar de novo mais
 * adiante de qualquer forma; um HMAC a mais é irrelevante, dois são desperdício.
 *
 * @param {import('express').Request} req
 * @returns {number|null}
 */
function resolveUserId(req) {
    if (req._rateLimitUserId !== undefined) return req._rateLimitUserId;

    let userId = null;
    const token = req.cookies?.accessToken;

    if (token) {
        try {
            const payload = jwtService.verifyAccessToken(token);
            const id = Number(payload?.id);
            if (Number.isInteger(id)) userId = id;
        } catch {
            // Expirado ou inválido: trata como anônimo. O fluxo de refresh do
            // `auth-session.service` ainda pode autenticar depois — nesse caso a
            // requisição só é contada no balde de IP, o que é aceitável e raro.
        }
    }

    req._rateLimitUserId = userId;
    return userId;
}

/** @returns {boolean} */
function isAuthenticated(req) {
    return resolveUserId(req) !== null;
}

/** @returns {boolean} */
function isAnonymous(req) {
    return !isAuthenticated(req);
}

/**
 * Chave do balde por usuário. Só usada quando há sessão — ver o `skip` do
 * `userLimiter`.
 * @returns {string}
 */
function userKey(req) {
    return `u:${resolveUserId(req)}`;
}

/**
 * Chave do login: IP + usuário tentado.
 *
 * Sem username no corpo (ex.: `/google-login`, que autentica por token) não há
 * o que compor e cai para IP puro.
 * @returns {string}
 */
function loginKey(req) {
    const username = String(req.body?.username ?? '')
        .trim()
        .toLowerCase()
        .slice(0, 100);

    return username ? `${ipKey(req)}:${username}` : ipKey(req);
}

/**
 * Chave da troca de senha: o usuário da sessão, com IP como recurso último.
 * @returns {string}
 */
function changePasswordKey(req) {
    const userId = resolveUserId(req);
    return userId !== null ? `u:${userId}` : ipKey(req);
}

/**
 * Handler padrão.
 *
 * Até 24/08/2026 os três limiters devolviam exatamente a mesma frase, em inglês,
 * sem indicar qual havia disparado nem quanto tempo esperar. Agora a mensagem
 * está em português (regra do `docs/error-messages-guide.md`) e vem acompanhada
 * de `code` e `retry_after_seconds`.
 *
 * ⚠️ `code` é o campo estável para o frontend decidir o que fazer — não o texto
 * da mensagem, que existe para ser lido por gente e pode ser reescrito.
 *
 * @param {string} code
 */
function limitReachedHandler(code) {
    return (req, res) => {
        const resetTime = req.rateLimit?.resetTime;
        const retryAfterSeconds = resetTime
            ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
            : null;

        res.status(429).json({
            error: true,
            message: 'Muitas tentativas. Tente novamente em alguns minutos.',
            code,
            retry_after_seconds: retryAfterSeconds,
        });
    };
}

const COMMON = {
    windowMs: WINDOW_MS,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
};

/**
 * Barreira geral para tráfego SEM sessão.
 *
 * Papel: conter varredura e flood de quem não está autenticado. Não é o que
 * limita o uso normal do sistema — quem tem sessão é contado pelo `userLimiter`
 * e sai daqui pelo `skip`. Por isso o limite é alto: 2000 em 15 min (~2,2/s
 * sustentado) é generoso para um cliente legítimo e ainda barra script solto.
 */
const apiLimiter = rateLimit({
    ...COMMON,
    limit: LIMITS.ip,
    keyGenerator: ipKey,
    skip: isAuthenticated,
    handler: limitReachedHandler('RATE_LIMIT_IP'),
});

/**
 * Limite por USUÁRIO autenticado.
 *
 * Esta é a correção do problema relatado: o balde é da pessoa, não do endereço.
 * Uso intenso de um usuário não afeta mais ninguém, e deixa de importar se
 * dez pessoas saem pelo mesmo IP do NAT ou dividem o mesmo terminal.
 *
 * 1000 em 15 min é dimensionado para a UI real, que faz várias chamadas por
 * tela e busca cada foto de colaborador como uma requisição própria
 * (`/global/files/:id`): dá ~1,1 req/s sustentado por pessoa, ordem de grandeza
 * acima do uso observado.
 */
const userLimiter = rateLimit({
    ...COMMON,
    limit: LIMITS.user,
    keyGenerator: userKey,
    skip: isAnonymous,
    handler: limitReachedHandler('RATE_LIMIT_USER'),
});

/**
 * Login — por IP **e** usuário tentado, 10 falhas.
 *
 * A chave composta é o ponto: com chave só de IP, dez senhas erradas de uma
 * pessoa travavam o login de todo mundo que saía por aquele IP. Com IP+usuário,
 * a trava alcança apenas a combinação que está de fato errando.
 *
 * Não usar só o username, de propósito: qualquer um poderia trancar a conta de
 * um colega de fora, só errando a senha dele dez vezes.
 *
 * `skipSuccessfulRequests` mantido — acerto não consome tentativa.
 */
const loginLimiter = rateLimit({
    ...COMMON,
    limit: LIMITS.login,
    keyGenerator: loginKey,
    handler: limitReachedHandler('RATE_LIMIT_LOGIN'),
    skipSuccessfulRequests: true,
});

/**
 * Login — teto por IP, independente de quantas contas foram tentadas.
 *
 * Complementa o `loginLimiter`: sem este, quem tem uma lista de usuários faria
 * 10 tentativas em cada conta a partir do mesmo IP, indefinidamente, porque
 * cada conta é uma chave nova. 50 falhas por IP em 15 min corta esse padrão sem
 * atrapalhar um andar inteiro de pessoas errando a própria senha.
 */
const loginIpLimiter = rateLimit({
    ...COMMON,
    limit: LIMITS.loginIp,
    keyGenerator: ipKey,
    handler: limitReachedHandler('RATE_LIMIT_LOGIN_IP'),
    skipSuccessfulRequests: true,
});

/**
 * Troca de senha própria — 5 falhas por USUÁRIO.
 *
 * A rota exige sessão, então o usuário é a chave certa; por IP, duas pessoas no
 * mesmo terminal disputavam as mesmas 5 tentativas. A rota pede a senha atual e
 * sem limite viraria oráculo de força bruta, mesmo com o cookie de sessão em
 * mãos — daí o limite mais apertado que o do login.
 */
const changePasswordLimiter = rateLimit({
    ...COMMON,
    limit: LIMITS.changePassword,
    keyGenerator: changePasswordKey,
    handler: limitReachedHandler('RATE_LIMIT_CHANGE_PASSWORD'),
    skipSuccessfulRequests: true,
});

module.exports = {
    apiLimiter,
    userLimiter,
    loginLimiter,
    loginIpLimiter,
    changePasswordLimiter,
    // Exportados para teste e documentação — não use nas rotas.
    LIMITS,
    WINDOW_MS,
    ipKey,
    userKey,
    loginKey,
    changePasswordKey,
    resolveUserId,
    isAuthenticated,
    isAnonymous,
};
