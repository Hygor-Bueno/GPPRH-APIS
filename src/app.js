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
  origin: ["http://localhost:3000", "http://localhost:5173", "https://vagas.gpprh.com.br", "http://10.10.10.99"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};

// Responde preflights OPTIONS explicitamente antes de qualquer outra rota
// Express 5 não aceita '*' como wildcard — usa regex
app.options(/.*/, cors(corsOptions));
app.use(cors(corsOptions));

// Rate limiting geral (200 req/IP a cada 15 min)
app.use(apiLimiter);


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
