const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");
const { apiLimiter } = require('./middlewares/rate-limit.middleware');

const app = express();

// Necessário quando a API está atrás de um proxy reverso (nginx, etc.)
// Permite que express-rate-limit use o IP real do cliente via X-Forwarded-For
app.set('trust proxy', 1);

// Carregar middlewares básicos
app.use(express.json());
app.use(cookieParser());

// CORS deve vir ANTES do rate limiter para que respostas 429
// também incluam os headers de CORS (evita falso erro de CORS no browser)
const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173","https://localhost:5173", "https://vagas.gpprh.com.br", "http://10.10.10.99", "http://gigpp.com.br:72", "http://gigpp.com.br:73", "http://10.10.10.99:73"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};

// Handler explícito de preflight — garante CORS headers antes de qualquer rota
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (corsOptions.origin.includes(origin)) {
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

// Servir arquivos de upload estaticamente (ex.: /uploads/chat/arquivo.jpg)
// __dirname aqui = .../api/src → sobe 1 nível para .../api/uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));


// Rotas dos módulos
const globalRoutes = require('./modules/global/routes');
app.use('/global', globalRoutes);

const protheusRoutes = require('./modules/protheus/routes');
app.use('/protheus', protheusRoutes);

const gpprhRoutes = require('./modules/gpprh/routes');
const { errorHandler } = require('./middlewares/error.middleware');
app.use('/gpprh', gpprhRoutes);

const gippRoutes = require('./modules/gipp/routes');
app.use('/gipp', gippRoutes);

const wsRoutes = require('./websocket/routes/ws.routes');
app.use('/monitoring', wsRoutes);

/**
 * 🔹 404 (rota não encontrada)
 * Deve vir ANTES do errorHandler
 */
app.use((req, res, next) => {
  const err = new Error(`Route ${req.originalUrl} not found`);
  err.statusCode = 404;
  next(err);
});

/**
 * 🔹 Error middleware (SEMPRE por último)
 */
app.use(errorHandler);

module.exports = app;
