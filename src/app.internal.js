/**
 * @fileoverview Backend INTERNO — uso corporativo.
 *
 * Monta os módulos `global` (GTPP, EPP, GIPP-RH, chat, gestão de acessos,
 * recibos), `protheus`, `gipp` e as rotas de monitoramento do WebSocket.
 *
 * Este app NÃO deve ser publicado no domínio do site de vagas. Ele é o lado
 * que carrega Oracle (thick mode), SQL Server e Puppeteer.
 *
 * @module app.internal
 */

const { createApp } = require('./app.factory');
const globalRoutes = require('./modules/global/routes');
const protheusRoutes = require('./modules/protheus/routes');
const gippRoutes = require('./modules/gipp/routes');
const mealRoutes = require('./modules/meal/routes');
const wsRoutes = require('./websocket/routes/ws.routes');

const ALLOWED_ORIGINS = [
  // frontends internos servidos pelo Apache do 10.10.10.99 (portas 72/73)
  'http://10.10.10.99',
  'http://10.10.10.99:73',
  'http://gigpp.com.br:72',
  'http://gigpp.com.br:73',
  'https://gigpp.com.br:73',
  // desenvolvimento local
  'http://localhost:3000',
  'http://localhost:5173',
  'https://localhost:5173'
];

module.exports = createApp({
  allowedOrigins: ALLOWED_ORIGINS,
  // anexos de chat (uploads/chat/...) — só o interno tem rota de upload
  serveUploads: true,
  routes: [
    { prefix: '/global', router: globalRoutes },
    { prefix: '/protheus', router: protheusRoutes },
    { prefix: '/gipp', router: gippRoutes },
    // Sob /gipp porque o prefixo identifica a fonte de dados, não o módulo: o
    // refeitório lê GIPP.dbo. Ver o comentário em app.js.
    { prefix: '/gipp/meal', router: mealRoutes },
    { prefix: '/monitoring', router: wsRoutes }
  ]
});
