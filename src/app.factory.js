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
const { apiLimiter } = require('./middlewares/rate-limit.middleware');
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

  // Necessário quando a API está atrás de um proxy reverso (Apache, etc.)
  // Permite que express-rate-limit use o IP real do cliente via X-Forwarded-For
  app.set('trust proxy', 1);

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

  // Rate limiting geral (200 req/IP a cada 15 min)
  app.use(apiLimiter);

  if (serveUploads) {
    // __dirname aqui = .../api/src → sobe 1 nível para .../api/uploads
    app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
  }

  for (const { prefix, router } of routes) {
    app.use(prefix, router);
  }

  // 404 — deve vir ANTES do errorHandler
  app.use((req, res, next) => {
    const err = new Error(`Route ${req.originalUrl} not found`);
    err.statusCode = 404;
    next(err);
  });

  // Error middleware (SEMPRE por último)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
