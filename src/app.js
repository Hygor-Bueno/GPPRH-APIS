const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");
const { apiLimiter } = require('./middlewares/rate-limit.middleware');

const app = express();

// Proxies confiáveis por ENDEREÇO — ver o comentário longo em `app.factory.js`,
// que é o arquivo vivo. Este monolito está parado desde 06/08/2026; alinhado
// aqui só para não sugerir que `trust proxy = 1` ainda é o valor correto.
app.set('trust proxy', ['loopback', '172.16.0.0/12', '10.10.10.99']);

// Carregar middlewares básicos
/**
 * Corpo JSON maior APENAS no autocadastro facial.
 *
 * A página do link envia as 3 a 5 capturas em base64 dentro do JSON — no
 * navegador a imagem já está em memória como data URL, e montar multipart ali
 * seria trabalho para desfazer no servidor. Cinco fotos passam facilmente do
 * limite padrão de 100 KB do `express.json()`, e o sintoma é um `413` que não
 * diz qual limite estourou.
 *
 * Registrado ANTES do parser global de propósito: o body-parser marca
 * `req._body` e o parser seguinte não reprocessa. Escopo restrito ao caminho, e
 * não global, porque abrir 15 MB de JSON em toda rota da API é superfície de
 * ataque de graça — o caminho do app continua sendo multipart, com o limite do
 * multer.
 */
app.use('/gipp/meal/enroll', express.json({ limit: '15mb' }));

app.use(express.json());
app.use(cookieParser());

// CORS deve vir ANTES do rate limiter para que respostas 429
// também incluam os headers de CORS (evita falso erro de CORS no browser)
const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:5173","https://localhost:5173", "https://vagas.gpprh.com.br", "http://10.10.10.99", "http://gigpp.com.br:72", "http://gigpp.com.br:73", "http://10.10.10.99:73","https://gigpp.com.br:73"],
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

// Controle de refeitório — etapa 2. Tabelas em GIPP.dbo desde 18/08/2026
// (refeitorio_etapa1_deploy.sql).
//
// Montado sob `/gipp` porque o prefixo de rota aqui identifica a FONTE DE DADOS,
// não o módulo: `/global` é o MySQL, `/gipp` é o SQL Server GIPP, `/protheus` é
// o Protheus. O refeitório lê `GIPP.dbo`, então mora em `/gipp/meal` — assim não
// é preciso uma regra nova de proxy no Apache para cada módulo novo.
const mealRoutes = require('./modules/meal/routes');
app.use('/gipp/meal', mealRoutes);

const wsRoutes = require('./websocket/routes/ws.routes');
app.use('/monitoring', wsRoutes);

/**
 * 🔹 404 (rota não encontrada)
 * Deve vir ANTES do errorHandler
 */
app.use((req, res, next) => {
  const err = new Error(`Rota ${req.originalUrl} não encontrada.`);
  err.statusCode = 404;
  next(err);
});

/**
 * 🔹 Error middleware (SEMPRE por último)
 */
app.use(errorHandler);

module.exports = app;
