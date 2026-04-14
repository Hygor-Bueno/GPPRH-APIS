const sql = require('mssql');
require('dotenv').config();

const config = {
  user: process.env.PROTHEUS_DB_USER,
  password: process.env.PROTHEUS_DB_PASSWORD,
  server: process.env.PROTHEUS_DB_SERVER,
  database: process.env.PROTHEUS_DB_DATABASE,
  port: parseInt(process.env.PROTHEUS_DB_PORT || '1433', 10),
  options: {
    encrypt: (process.env.PROTHEUS_DB_OPTIONS_ENCRYPT === 'true'),
    enableArithAbort: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
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
