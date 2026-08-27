/**
 * @fileoverview Entrypoint do backend PÚBLICO (site de vagas).
 *
 * Diferença deliberada em relação ao `server.js`: NÃO faz warm-up do pool do
 * Protheus (SQL Server). O módulo `gpprh` não usa SQL Server, e importar
 * `config/protheus` aqui abriria uma conexão com o ERP a partir do processo
 * exposto à internet.
 *
 * @module server.public
 */

require('dotenv').config({
  path: require('path').join(__dirname, '../.env')
});

const app = require('./app.public');

// Porta própria para poder rodar em paralelo ao `server.js` (4000) durante a
// validação, sem colisão. O Apache passa a apontar para cá na virada.
const PORT = process.env.PORT_PUBLIC || 4010;

app.listen(PORT, () => {
  console.log(`[public] Backend de vagas rodando na porta ${PORT}`);
});
