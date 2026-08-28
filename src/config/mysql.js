const mysql = require('mysql2/promise');
require('dotenv').config();

const DEFAULT_QUERY_TIMEOUT_MS = 15000;

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

/**
 * mysql2 não tem timeout para quem espera na fila por uma conexão livre
 * (connectTimeout só cobre a criação de conexão nova). Sem isso, se o pool
 * ficar saturado, getConnection() fica pendurado para sempre e trava a
 * requisição inteira sem nunca responder.
 *
 * Envolve getConnection() com um limite de tempo de espera. Se a conexão
 * real chegar depois do timeout já ter disparado, ela é liberada de volta
 * ao pool imediatamente (senão ficaria vazando, presa fora do pool).
 *
 * Aplicado no pool "core" (callback-based, `pool.pool`) em vez do wrapper
 * promise — assim cobre tanto `pool.getConnection()` quanto `pool.query()` /
 * `pool.execute()` chamados direto no pool, já que ambos chamam o
 * getConnection() do core internamente.
 */
function withAcquireTimeout(pool, ms = 8000) {
    const corePool = pool.pool;
    const originalGetConnection = corePool.getConnection.bind(corePool);

    corePool.getConnection = function (cb) {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            cb(new Error(`Timeout de ${ms}ms aguardando conexão livre no pool — pool pode estar esgotado`));
        }, ms);

        originalGetConnection((err, conn) => {
            if (settled) {
                if (!err) conn.release();
                return;
            }
            settled = true;
            clearTimeout(timer);
            cb(err, conn);
        });
    };

    return pool;
}

/**
 * mysql2 não aplica nenhum timeout de execução por padrão — uma query travada
 * (lock, deadlock, ERP lento do outro lado de uma FEDERATED/consulta pesada)
 * fica presa na conexão para sempre, segurando a conexão fora do pool e
 * travando a requisição que espera pelo resultado dela. Isso é o principal
 * responsável por requisições "pending" sem retorno: a conexão nunca volta
 * pro pool, e as próximas requisições vão esgotando as conexões restantes.
 *
 * Injeta um timeout default (`ms`) em toda query que não especificar o
 * próprio timeout:
 *
 *  - `pool.query()`/`pool.execute()` chamados direto no pool: o mysql2 já
 *    cuida do ciclo de vida da conexão internamente nesse caso — só libera
 *    (ou destrói, se for erro read-only) quando o pacote real do servidor
 *    chega, então basta injetar o timeout.
 *
 *  - `getConnection()` manual + `conn.query()`/`conn.execute()`: aqui o
 *    `finally { conn.release() }` escrito pelo chamador rodaria assim que a
 *    promise do timeout rejeitar — ANTES do servidor realmente terminar a
 *    query pendente. Devolver essa conexão pro pool nesse estado corrompe a
 *    próxima query que a pegar (dessincroniza o protocolo). Por isso,
 *    marcamos a conexão como "timed out" e forçamos destroy() no lugar do
 *    release(), removendo-a do pool em vez de reaproveitá-la.
 */
function withQueryTimeout(pool, ms = DEFAULT_QUERY_TIMEOUT_MS) {
    const corePool = pool.pool;

    for (const method of ['query', 'execute']) {
        const original = corePool[method].bind(corePool);
        corePool[method] = function (sql, values, cb) {
            if (typeof sql === 'string') {
                sql = { sql, timeout: ms };
            } else if (sql && typeof sql === 'object' && sql.timeout === undefined) {
                sql = { ...sql, timeout: ms };
            }
            return original(sql, values, cb);
        };
    }

    const originalGetConnection = pool.getConnection.bind(pool);
    pool.getConnection = async function (...args) {
        const conn = await originalGetConnection(...args);

        for (const method of ['query', 'execute']) {
            const originalMethod = conn[method].bind(conn);
            conn[method] = function (sql, values) {
                const opts = typeof sql === 'string'
                    ? { sql, timeout: ms }
                    : { timeout: ms, ...sql };
                return originalMethod(opts, values).catch((err) => {
                    if (err.code === 'PROTOCOL_SEQUENCE_TIMEOUT') conn._queryTimedOut = true;
                    throw err;
                });
            };
        }

        const originalRelease = conn.release.bind(conn);
        conn.release = function () {
            if (conn._queryTimedOut) return conn.destroy();
            return originalRelease();
        };

        return conn;
    };

    return pool;
}

function buildPool(config) {
    return withQueryTimeout(withAcquireTimeout(enforceUtf8mb4(mysql.createPool(config))));
}

const poolGpprh = buildPool({
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
});

const poolGlobal = buildPool({
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
});

const poolGippMySQL = buildPool({
  host: process.env.MYSQL_GIPP_HOST,
  user: process.env.MYSQL_GIPP_USER,
  password: process.env.MYSQL_GIPP_PASSWORD,
  database: process.env.MYSQL_GIPP_DATABASE,
  port: Number(process.env.MYSQL_GIPP_PORT || 3306),
  charset: 'utf8mb4',
  waitForConnections: true,
  // Mesmo servidor do poolGlobal (10.10.10.99) — reduzido porque esse pool só
  // atende a replicação de pagamento (um registro por vez, baixo volume),
  // deixando mais margem pro poolGlobal no teto compartilhado de conexões.
  connectionLimit: 15,
  queueLimit: 50,
  connectTimeout: 10000,
});

module.exports = { poolGpprh, poolGlobal, poolGippMySQL };
