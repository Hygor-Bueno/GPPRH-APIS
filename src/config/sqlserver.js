const sql = require('mssql');
require('dotenv').config();

const config = {
  user: process.env.GIPP_SQLSERVER_DB_USER,
  password: process.env.GIPP_SQLSERVER_DB_PASSWORD,
  server: process.env.GIPP_SQLSERVER_DB_SERVER,
  database: process.env.GIPP_SQLSERVER_DB_DATABASE,
  port: parseInt(process.env.GIPP_SQLSERVER_DB_PORT || '1433', 10),
  options: {
    encrypt: (process.env.GIPP_SQLSERVER_DB_OPTIONS_ENCRYPT === 'true'),
    enableArithAbort: true
  },
  // Reduzido de 60s pra 30s — alinhado com config/protheus.js, ainda generoso
  // pro processamento de jornada/recibo, sem deixar uma query travada seguras
  // a conexão por 1 minuto inteiro.
  requestTimeout: 30000,
  pool: {
    // 20 por instância x 2 instâncias do PM2 (cluster) = 40 conexões concorrentes,
    // validado empiricamente em 2026-07 (40/40 aceitas em ~112ms, sem recusa).
    // Cálculo de pico esperado (~1000 colaboradores, uso escalonado 06h-22h,
    // rajada de troca de turno): ~10-15 conexões simultâneas — 40 dá margem confortável.
    max: 20,
    min: 0,
    idleTimeoutMillis: 30000,
    // Sem isso, o default implícito da lib tarn (30s) fica sujeito a mudar
    // de versão para versão. Deixamos explícito e alinhado ao timeout do MySQL.
    acquireTimeoutMillis: 10000
  }
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log('MSSQL pool criado');
    return pool;
  })
  .catch(err => {
    console.error('Erro criando pool MSSQL', err);
    throw err;
  });

module.exports = {
  sql,
  poolPromise
};
