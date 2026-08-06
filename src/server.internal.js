/**
 * @fileoverview Entrypoint do backend INTERNO (uso corporativo).
 *
 * Mantém o warm-up do pool do Protheus que existe no `server.js` — este é o
 * lado que realmente fala com o SQL Server.
 *
 * @module server.internal
 */

require('dotenv').config({
  path: require('path').join(__dirname, '../.env')
});

const app = require('./app.internal');

// Importa somente UMA vez o pool
const { poolPromise } = require('./config/protheus');

// Porta própria para rodar em paralelo ao `server.js` (4000) durante a
// validação. O Apache passa a apontar para cá na virada.
const PORT = process.env.PORT_INTERNAL || 4002;

app.listen(PORT, () => {
  console.log(`[internal] Backend interno rodando na porta ${PORT}`);
});

// Teste de conexão MSSQL no startup
(async () => {
  try {
    await poolPromise;
    console.log('[internal] Conectado ao Protheus MSSQL');
  } catch (err) {
    console.error('[internal] Erro conectando ao Protheus:', err.message || err);
  }
})();
