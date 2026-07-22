/**
 * @fileoverview Oracle database connection pool.
 *
 * Pool lazy-inicializado — criado na primeira chamada de `oracleQuery()`.
 * Requer: npm install oracledb + Oracle Instant Client instalado no servidor.
 *
 * Variáveis de ambiente:
 *   ORACLE_USER           - Usuário Oracle
 *   ORACLE_PASSWORD       - Senha Oracle
 *   ORACLE_CONNECT_STRING - Ex: "192.168.0.10:1521/ORCL" ou "(DESCRIPTION=...)"
 *   ORACLE_CLIENT_PATH    - (opcional) caminho para o Oracle Instant Client
 *                           Ex: "C:\\oracle\\instantclient_21_3"
 *                           Se omitido, assume que o client está no PATH.
 *
 * @module config/oracle
 */

let oracledb;
try {
    oracledb = require('oracledb');
} catch {
    // oracledb não está instalado — as rotas Oracle retornarão erro descritivo
    oracledb = null;
}
require('dotenv').config();

// Retornar linhas como objetos ({ col: val }) em vez de arrays
if (oracledb) oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let _poolPromise = null;
let _clientInit  = false;

/**
 * Inicializa o Oracle Instant Client uma única vez por processo.
 * Apenas necessário se ORACLE_CLIENT_PATH estiver definido no .env.
 * @private
 */
function _initClient() {
    if (_clientInit) return;
    _clientInit = true;
    if (process.env.ORACLE_CLIENT_PATH) {
        oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_PATH });
    }
}

/**
 * Retorna o pool Oracle compartilhado (cria-o na primeira chamada).
 * @returns {Promise<oracledb.Pool>}
 * @throws {Error} Se oracledb não estiver instalado ou variáveis de ambiente ausentes.
 */
function getOraclePool() {
    if (!oracledb) {
        throw new Error(
            'oracledb não está instalado. Execute: npm install oracledb ' +
            'e instale o Oracle Instant Client no servidor.'
        );
    }
    if (!process.env.ORACLE_USER || !process.env.ORACLE_CONNECT_STRING) {
        throw new Error(
            'Variáveis de ambiente Oracle não configuradas: ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING'
        );
    }
    if (!_poolPromise) {
        _initClient();
        _poolPromise = oracledb.createPool({
            user:                    process.env.ORACLE_USER,
            password:                process.env.ORACLE_PASSWORD,
            connectString:           process.env.ORACLE_CONNECT_STRING,
            poolMin:                 1,
            poolMax:                 5,
            poolIncrement:           1,
            queueTimeout:            60000,
            useNewPasswordVerifiers: true   // suporte a hash moderno sem Thick mode
        });
    }
    return _poolPromise;
}

/**
 * Executa uma query Oracle e retorna todas as linhas como objetos.
 *
 * @param {string} sql   - SQL com bind variables nomeados (:name)
 * @param {object} binds - Valores dos bind variables
 * @returns {Promise<object[]>}
 */
async function oracleQuery(sql, binds = {}) {
    const pool = await getOraclePool();
    const conn = await pool.getConnection();
    try {
        const result = await conn.execute(sql, binds, {
            outFormat:      oracledb.OUT_FORMAT_OBJECT,
            fetchArraySize: 200
        });
        return result.rows || [];
    } finally {
        await conn.close();
    }
}

/**
 * Valida e constrói uma lista segura de inteiros para cláusula IN.
 * Usado nas queries Oracle onde IN com bind array não é suportado nativamente.
 * Os valores DEVEM vir do banco de dados próprio (não de input do usuário).
 *
 * @param {(number|string)[]} ids - Array de IDs inteiros
 * @returns {string} Ex: "1234,5678,9012"
 * @throws {Error} Se algum valor não for inteiro válido
 */
function buildIntList(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
        throw new Error('buildIntList: lista vazia ou inválida');
    }
    return ids.map(id => {
        const n = parseInt(id, 10);
        if (isNaN(n) || !Number.isFinite(n)) {
            throw new Error(`buildIntList: valor inválido "${id}" — apenas inteiros são permitidos`);
        }
        return n;
    }).join(',');
}

module.exports = { getOraclePool, oracleQuery, buildIntList };
