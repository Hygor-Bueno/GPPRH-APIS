/**
 * @fileoverview Acesso ao `poolGlobal` compartilhado pelos adapters do CPPP.
 *
 * Mesmo desenho do `miepp-mysql.helper`: concentra a tradução de erro para que
 * nenhuma mensagem crua do MySQL (nome de coluna, SQL, host) chegue ao
 * cliente. `pool.query()` e não `execute()` pelo mesmo motivo de lá: `LIMIT ?`,
 * `(? IS NULL OR ...)` e o `VALUES ?` da carga em lote só funcionam com o
 * escape do lado do cliente — que continua parametrizado.
 *
 * @module modules/global/infrastructure/cppp/cppp-mysql.helper
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');

const ERROR_CODE = 'CPPP_MYSQL_ERROR';

function wrap(error, message) {
    if (error instanceof AppError) return error;
    return new AppError(message, 500, { code: ERROR_CODE, details: error });
}

/** @returns {Promise<Array>} linhas. */
async function query(sql, params = []) {
    try {
        const [rows] = await poolGlobal.query(sql, params);
        return rows;
    } catch (error) {
        throw wrap(error, 'Erro ao acessar o banco de dados do ponto.');
    }
}

/** @returns {Promise<object>} `ResultSetHeader`. */
async function execute(sql, params = []) {
    try {
        const [result] = await poolGlobal.query(sql, params);
        return result;
    } catch (error) {
        throw wrap(error, 'Erro ao gravar no banco de dados do ponto.');
    }
}

/**
 * Bloco numa transação, com rollback e release garantidos.
 * @param {(conn: object) => Promise<*>} run
 */
async function transaction(run) {
    const conn = await poolGlobal.getConnection();
    try {
        await conn.beginTransaction();
        const result = await run(conn);
        await conn.commit();
        return result;
    } catch (error) {
        try { await conn.rollback(); } catch { /* conexão já pode ter caído */ }
        throw wrap(error, 'Erro ao gravar no banco de dados do ponto.');
    } finally {
        conn.release();
    }
}

async function count(sql, params = []) {
    const rows = await query(sql, params);
    return Number(rows[0]?.total ?? 0);
}

/**
 * A violação de chave única chegou do MySQL? (o erro original fica em
 * `details` depois do `wrap`).
 */
function isDuplicate(error) {
    return (error?.details?.code ?? error?.code) === 'ER_DUP_ENTRY';
}

module.exports = { query, execute, transaction, count, isDuplicate, ERROR_CODE };
