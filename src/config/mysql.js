const mysql = require('mysql2/promise');
require('dotenv').config();

const poolGpprh = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const poolGlobal = mysql.createPool({
  host: process.env.MYSQL_GLOBAL_HOST,
  user: process.env.MYSQL_GLOBAL_USER,
  password: process.env.MYSQL_GLOBAL_PASSWORD,
  database: process.env.MYSQL_GLOBAL_DATABASE,
  port: Number(process.env.MYSQL_GLOBAL_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const poolGippMySQL = mysql.createPool({
  host: process.env.MYSQL_GIPP_HOST,
  user: process.env.MYSQL_GIPP_USER,
  password: process.env.MYSQL_GIPP_PASSWORD,
  database: process.env.MYSQL_GIPP_DATABASE,
  port: Number(process.env.MYSQL_GIPP_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = { poolGpprh, poolGlobal, poolGippMySQL };
