const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");

const app = express();

// Carregar middlewares básicos
app.use(express.json());
app.use(cookieParser());

// CORS - permitir credenciais (cookies)
app.use(cors({
  origin: ["http://localhost:3000", "https://vagas.gpprh.com.br"],
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: true
}));


// Rotas dos módulos
const protheusRoutes = require('./modules/protheus/routes');
app.use('/protheus', protheusRoutes);

const gpprhRoutes = require('./modules/gpprh/routes');
app.use('/gpprh', gpprhRoutes);

module.exports = app;
