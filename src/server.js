// Carrega o .env sempre da pasta raiz do projeto (../.env)
require('dotenv').config({
  path: require('path').join(__dirname, '../.env')
});

const app = require('./app');

// Importa somente UMA vez o pool
const { poolPromise } = require('./config/protheus');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server rodando na porta ${PORT}`);
});

// Teste de conexão MSSQL no startup
(async () => {
  try {
    await poolPromise;
    console.log('Conectado ao Protheus MSSQL');
  } catch (err) {
    console.error('Erro conectando ao Protheus:', err.message || err);
  }
})();
