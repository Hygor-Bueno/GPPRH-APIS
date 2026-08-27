/**
 * @fileoverview Backend PÚBLICO — site de vagas / candidatos.
 *
 * Monta exclusivamente o módulo `gpprh`. Este é o único app que deve atender
 * em `vagas.gpprh.com.br`.
 *
 * O módulo `gpprh` é autossuficiente: usa apenas `poolGpprh` (MySQL local) e
 * `google-auth-library`, e as permissões vêm de claims do JWT
 * (`permission.middleware.js`), não de query. Não carrega Oracle, SQL Server
 * nem Puppeteer.
 *
 * @module app.public
 */

const { createApp } = require('./app.factory');
const gpprhRoutes = require('./modules/gpprh/routes');

const ALLOWED_ORIGINS = [
  'https://vagas.gpprh.com.br',
  // desenvolvimento local do frontend de vagas
  'http://localhost:3000',
  'http://localhost:5173',
  'https://localhost:5173'
];

module.exports = createApp({
  allowedOrigins: ALLOWED_ORIGINS,
  routes: [
    { prefix: '/gpprh', router: gpprhRoutes }
  ]
});
