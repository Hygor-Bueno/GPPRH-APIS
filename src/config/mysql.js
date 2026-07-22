const mysql = require('mysql2/promise');
require('dotenv').config();

/**
 * Garante UTF-8 completo (emoji, acentos, etc.) em cada conexão do pool.
 * O option `charset` no createPool só negocia o charset no handshake —
 * não equivale a SET NAMES, que é necessário para forçar a codificação
 * na camada de protocolo de texto.
 */
function enforceUtf8mb4(pool) {
    pool.pool.on('connection', (conn) => {
        conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    });
    return pool;
}

const poolGpprh = enforceUtf8mb4(mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT || 3306),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 30,
  queueLimit: 50,
  connectTimeout: 10000,
}));

const poolGlobal = enforceUtf8mb4(mysql.createPool({
  host: process.env.MYSQL_GLOBAL_HOST,
  user: process.env.MYSQL_GLOBAL_USER,
  password: process.env.MYSQL_GLOBAL_PASSWORD,
  database: process.env.MYSQL_GLOBAL_DATABASE,
  port: Number(process.env.MYSQL_GLOBAL_PORT || 3306),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 30,
  queueLimit: 50,
  connectTimeout: 10000,
}));

const poolGippMySQL = enforceUtf8mb4(mysql.createPool({
  host: process.env.MYSQL_GIPP_HOST,
  user: process.env.MYSQL_GIPP_USER,
  password: process.env.MYSQL_GIPP_PASSWORD,
  database: process.env.MYSQL_GIPP_DATABASE,
  port: Number(process.env.MYSQL_GIPP_PORT || 3306),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 30,
  queueLimit: 50,
  connectTimeout: 10000,
}));

module.exports = { poolGpprh, poolGlobal, poolGippMySQL };
