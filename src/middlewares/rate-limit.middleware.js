const rateLimit = require('express-rate-limit');

/**
 * Handler padrão para quando o limite é atingido.
 * Retorna o mesmo formato de erro do errorHandler central.
 */
const limitReachedHandler = (req, res) => {
    res.status(429).json({
        error: true,
        message: 'Too many attempts. Please try again in a few minutes.'
    });
};

/**
 * Limiter para rotas de login (AD, Google, Global).
 * 10 tentativas por IP a cada 15 minutos.
 * Protege contra ataques de força bruta nas credenciais.
 */
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: limitReachedHandler,
    skipSuccessfulRequests: true // só conta tentativas falhas
});

/**
 * Limiter geral para a API.
 * 200 requisições por IP a cada 15 minutos.
 * Proteção básica contra scraping e abuso.
 */
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    limit: 200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: limitReachedHandler
});

/**
 * Limiter para troca de senha própria.
 * 5 tentativas por IP a cada 15 minutos, contando só as que falharam.
 *
 * A rota exige a senha atual, então sem limite ela viraria um oráculo para
 * descobri-la por força bruta — mesmo o atacante já tendo o cookie de sessão.
 * Mais restrito que o login porque troca de senha é operação rara.
 */
const changePasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: limitReachedHandler,
    skipSuccessfulRequests: true
});

module.exports = { loginLimiter, changePasswordLimiter, apiLimiter };
