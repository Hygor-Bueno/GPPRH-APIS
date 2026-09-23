/**
 * @fileoverview Fábrica de instâncias Express.
 *
 * Existe para permitir que o backend rode como dois processos independentes —
 * um público (candidatos, módulo `gpprh`) e um interno (GTPP, EPP, GIPP-RH,
 * Protheus, WebSocket) — compartilhando a mesma configuração de middleware sem
 * duplicá-la.
 *
 * Desde 2026-08-06 esta fábrica é o caminho de PRODUÇÃO: os containers rodam
 * `server.internal.js` e `server.public.js`, que consomem `app.internal.js` e
 * `app.public.js`. O `app.js`/`server.js` monolítico é legado — só o
 * `ecosystem.config.js` da raiz (PM2 do host, parado) aponta para ele, e pode
 * ser removido junto com a duplicação de middleware.
 *
 * @module app.factory
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { apiLimiter, userLimiter } = require('./middlewares/rate-limit.middleware');
const { cleanupUploads } = require('./middlewares/cleanup-uploads.middleware');
const { errorHandler } = require('./middlewares/error.middleware');

/**
 * Monta uma instância Express com o middleware comum aos dois backends.
 *
 * @param {object} options
 * @param {string[]} options.allowedOrigins
 *   Origens aceitas pelo CORS. Cada backend recebe só as suas — o app público
 *   não precisa liberar os frontends internos e vice-versa.
 * @param {Array<{ prefix: string, router: import('express').Router }>} options.routes
 *   Rotas a montar, na ordem informada.
 * @param {boolean} [options.serveUploads=false]
 *   Serve `../uploads` estaticamente. Só o backend interno precisa (anexos de
 *   chat); o público não tem rota de upload.
 * @returns {import('express').Express}
 */
function createApp({ allowedOrigins, routes, serveUploads = false }) {
  const app = express();

  /**
   * Proxies confiáveis, por ENDEREÇO e não por contagem de saltos.
   *
   * ─── O que estava errado com `trust proxy = 1` (corrigido em 15/09/2026) ───
   * A cadeia até o container tem DOIS saltos de proxy:
   *
   *   cliente → Apache do 10.10.10.99 → Apache do 192 na :4090 → container
   *
   * O `X-Forwarded-For` que chega é `<cliente>, 10.10.10.99`. Confiando em um
   * salto só, o Express pulava um da direita e parava em `10.10.10.99` — ou
   * seja, `req.ip` era o IP do servidor de frontend para TODO mundo, sempre.
   *
   * Três consequências medidas antes da correção:
   *   - `miepp_players.last_ip` gravava `10.10.10.99` para todas as telas;
   *   - todo rate limiting por IP caía num balde único: 50 senhas erradas na
   *     empresa inteira trancariam o `loginIpLimiter` de todos, e o
   *     `loginLimiter` (IP+username) degenerava em username puro — exatamente o
   *     que a refatoração de 24/08 quis evitar;
   *   - o IP de origem do consentimento biométrico do refeitório (LGPD, ver
   *     `meal-enroll.controller.js`) era gravado sempre igual, o que o próprio
   *     comentário de lá descreve como "o mesmo que não registrar".
   *
   * O teste de 24/08 ("forjei X-Forwarded-For e o balde não mudou") é
   * indistinguível de "o balde é sempre o mesmo" — as duas situações produzem a
   * mesma observação, e era a segunda que estava acontecendo.
   *
   * ─── Por que por endereço, e não `trust proxy = 2` ────────────────────────
   * Contar saltos quebra silenciosamente quando a cadeia muda de tamanho — e
   * ela já é diferente entre o backend interno (2 saltos) e o público (1, pelo
   * Apache do próprio 192). Por endereço, cada um resolve o seu sozinho.
   *
   * Continua não-spoofável: o Express caminha o XFF da direita para a esquerda
   * pulando só os endereços desta lista e para no primeiro que não está nela.
   * Entradas forjadas pelo cliente ficam à ESQUERDA das reais e nunca são
   * alcançadas.
   *
   *   loopback        → dev local e chamadas internas
   *   172.16.0.0/12   → gateway da bridge do Docker (é o peer do socket)
   *   10.10.10.99     → Apache do servidor de frontend
   */
  app.set('trust proxy', ['loopback', '172.16.0.0/12', '10.10.10.99']);

  /**
   * Corpo JSON maior APENAS no autocadastro facial.
   *
   * A página do link envia as 3 a 5 capturas em base64 dentro do JSON — no
   * navegador a imagem já está em memória como data URL. Cinco fotos passam do
   * limite padrão de 100 KB do `express.json()`, e o sintoma é um `413` que não
   * diz qual limite estourou.
   *
   * Antes do parser global: o body-parser marca `req._body` e o seguinte não
   * reprocessa. Escopo por caminho, e não global, porque 15 MB de JSON em toda
   * rota é superfície de ataque de graça — o caminho do app continua multipart,
   * com o limite do multer.
   */
  app.use('/gipp/meal/enroll', express.json({ limit: '15mb' }));

  app.use(express.json());
  app.use(cookieParser());

  const corsOptions = {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  };

  // CORS deve vir ANTES do rate limiter para que respostas 429
  // também incluam os headers de CORS (evita falso erro de CORS no browser)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '0');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(cors(corsOptions));

  // Rate limiting em duas camadas MUTUAMENTE EXCLUSIVAS — ver o cabeçalho de
  // rate-limit.middleware para o porquê de cada limite:
  //   apiLimiter  → só tráfego SEM sessão, por IP        (2000 / 15 min)
  //   userLimiter → só tráfego COM sessão, por usuário   (1000 / 15 min)
  //
  // Precisa vir depois do cookieParser: é do cookie `accessToken` que sai a
  // identidade usada como chave. E antes das rotas, senão não protege nada.
  app.use(apiLimiter);
  app.use(userLimiter);

  if (serveUploads) {
    // __dirname aqui = .../api/src → sobe 1 nível para .../api/uploads
    app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
  }

  // Remove os temporários do multer ao fim de CADA requisição — inclusive as
  // que falharam. Antes do roteamento para valer também para rota que estoura.
  app.use(cleanupUploads);

  for (const { prefix, router } of routes) {
    app.use(prefix, router);
  }

  // 404 — deve vir ANTES do errorHandler
  app.use((req, res, next) => {
    const err = new Error(`Rota ${req.originalUrl} não encontrada.`);
    err.statusCode = 404;
    next(err);
  });

  // Error middleware (SEMPRE por último)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
