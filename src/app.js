const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");

const app = express();

// Carregar middlewares básicos
app.use(express.json());
app.use(cookieParser());

// CORS - permitir credenciais (cookies)
app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:5173", "https://vagas.gpprh.com.br"],
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: true
}));


// Rotas dos módulos
const globalRoutes = require('./modules/global/routes');
app.use('/global', globalRoutes);

const protheusRoutes = require('./modules/protheus/routes');
app.use('/protheus', protheusRoutes);

const gpprhRoutes = require('./modules/gpprh/routes');
const { errorHandler } = require('./middlewares/error.middleware');
app.use('/gpprh', gpprhRoutes);

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
