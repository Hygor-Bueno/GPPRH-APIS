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
 * ⚠️ CORRIGIDO EM 15/09/2026 — a conclusão abaixo estava errada.
 *
 * O texto original dizia: "`trust proxy` está correto. Verificado em 24/08/2026
 * mandando um `X-Forwarded-For` forjado de fora: o balde não mudou". O teste
 * foi feito, mas a conclusão não seguia: "o balde não mudou ao forjar" é
 * indistinguível de "o balde é sempre o mesmo" — e era o segundo caso.
 *
 * A cadeia até o container tem DOIS saltos (Apache do 10.10.10.99 → Apache do
 * 192 na :4090 → container), e `trust proxy = 1` fazia `req.ip` devolver
 * `10.10.10.99` para TODO mundo. Consequência: todo limiter por IP dividia um
 * balde único — 50 senhas erradas na empresa trancariam o login de todos, e o
 * `loginLimiter` (IP+username) virava username puro, que é exatamente o que a
 * refatoração de 24/08 queria evitar.
 *
 * Descoberto porque as três telas do MIEPP gravaram `last_ip = 10.10.10.99`.
 * Agora a confiança é por ENDEREÇO (ver `app.factory.js`), o que resolve as
 * duas cadeias (interna de 2 saltos, pública de 1) e continua não-spoofável.
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

const crypto = require('crypto');
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
    /** Tráfego das rotas `/miepp/device/*`, por dispositivo. */
    device: 900,
    /** Tentativas de pareamento (`POST /miepp/device/pair`), por IP. */
    pair: 10,
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
    // Tráfego de player do miepp também sai daqui: não tem sessão, mas tem
    // limiter próprio por dispositivo (`deviceLimiter`). Ver `isMieppDeviceTraffic`.
    skip: (req) => isAuthenticated(req) || isMieppDeviceTraffic(req),
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

/**
 * Chave dos dispositivos miepp: o próprio token, resumido.
 *
 * Pelo mesmo motivo que o tráfego autenticado é contado por usuário e não por
 * IP, o tráfego de player é contado por PLAYER. Numa loja, todas as telas saem
 * pelo mesmo endereço — com chave de IP, uma caixa em laço de retry consumiria
 * a cota das outras telas do mesmo lugar e derrubaria a veiculação inteira.
 *
 * A chave é o SHA-256 do token, não o token: o valor vira chave de um `Map` em
 * memória e aparece em dump de heap e em log de depuração. O hash identifica o
 * dispositivo igualmente bem sem carregar o segredo junto.
 *
 * Não há consulta ao banco aqui — o limiter roda antes da autenticação. Um
 * token forjado só ganha um balde próprio e esbarra no 401 logo em seguida.
 * `POST /device/pair`, que não tem token, cai para IP.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function deviceKey(req) {
    const header = req.headers?.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;

    if (match) {
        const digest = crypto.createHash('sha256').update(match[1].trim()).digest('hex');
        return `d:${digest.slice(0, 32)}`;
    }

    // A rota de entrega de mídia não manda header: o player baixa o arquivo com
    // um cliente HTTP simples, autorizado pela assinatura na query. O `p` é
    // chave confiável mesmo vindo do cliente, porque a assinatura HMAC cobre
    // esse valor — trocar o `p` invalida a URL, então não dá para escapar do
    // balde forjando outro player.
    const playerId = Number(req.query?.p);
    if (Number.isInteger(playerId) && playerId > 0) return `d:p${playerId}`;

    return ipKey(req);
}

/**
 * A requisição é tráfego de player do miepp?
 *
 * Serve para tirá-la do `apiLimiter`. Sem isso, as telas — que não têm sessão —
 * cairiam no balde de IP, e numa loja todas saem pelo mesmo endereço: vinte
 * telas dividiriam as 2000 requisições por janela e começariam a receber 429 em
 * horário de pico. É a mesma armadilha descrita no topo deste arquivo, agora no
 * lado do dispositivo. O `deviceLimiter` cobre essas rotas por player.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isMieppDeviceTraffic(req) {
    const path = req.path || '';
    return path.includes('/miepp/device/') || /\/miepp\/media\/[^/]+\/file$/.test(path);
}

/**
 * Rotas `/miepp/device/*` — por DISPOSITIVO.
 *
 * O player chama em laço: heartbeat, playlist e fila de comandos. Com as
 * cadências previstas (heartbeat a cada 60s, playlist a cada 5 min, comandos a
 * cada 30s), uma tela gasta algo como 50–100 requisições por janela. 900 em 15
 * min (~1/s) deixa uma ordem de grandeza de folga para retry e ainda corta um
 * dispositivo em laço descontrolado antes que ele pese no banco.
 *
 * Vale a mesma ressalva do topo do arquivo: o contador é por processo e são 2
 * instâncias no cluster, então o teto real fica entre 900 e 1800.
 */
const deviceLimiter = rateLimit({
    ...COMMON,
    limit: LIMITS.device,
    keyGenerator: deviceKey,
    handler: limitReachedHandler('RATE_LIMIT_DEVICE'),
});

/**
 * Pareamento de tela — 10 tentativas por IP a cada 15 min.
 *
 * É a defesa principal do código de 8 dígitos. 10^8 combinações não resistem a
 * varredura por si: sem limite, alguém tentando continuamente acabaria casando
 * com algum código vivo e ganharia um token de dispositivo. Com 10 tentativas
 * por janela, varrer o espaço levaria tempo geológico, e os códigos são de uso
 * único e duram 10 minutos.
 *
 * `skipSuccessfulRequests` mantém a instalação legítima barata: parear uma tela
 * de verdade não consome tentativa. Quem gasta a cota é quem erra.
 *
 * ⚠️ Se um dia esta rota sair de trás deste limiter, o código precisa crescer —
 * o tamanho dele foi escolhido contando com esta barreira.
 */
const pairLimiter = rateLimit({
    ...COMMON,
    limit: LIMITS.pair,
    keyGenerator: ipKey,
    handler: limitReachedHandler('RATE_LIMIT_PAIR'),
    skipSuccessfulRequests: true,
});

module.exports = {
    apiLimiter,
    userLimiter,
    loginLimiter,
    loginIpLimiter,
    changePasswordLimiter,
    deviceLimiter,
    pairLimiter,
    // Exportados para teste e documentação — não use nas rotas.
    LIMITS,
    WINDOW_MS,
    ipKey,
    userKey,
    loginKey,
    changePasswordKey,
    deviceKey,
    isMieppDeviceTraffic,
    resolveUserId,
    isAuthenticated,
    isAnonymous,
};
