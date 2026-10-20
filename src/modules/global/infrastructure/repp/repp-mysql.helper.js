/**
 * @fileoverview Acesso ao `poolGlobal` dos adapters da REPP.
 *
 * Mesmo desenho do `miepp-mysql.helper`: concentra a tradução de erro para
 * que nenhuma mensagem crua do MySQL (coluna, SQL, host) chegue ao cliente —
 * o `AppError` leva o detalhe, e o `error.middleware` decide o que sai.
 *
 * `pool.query()` e não `execute()`: as consultas usam `IN (?)` com lista, que
 * só o escape do lado do cliente expande. Continua parametrizado.
 *
 * @module modules/global/infrastructure/repp/repp-mysql.helper
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { ReppErrorCode } = require('../../domain/repp/repp.enums');

const ERROR_CODE = ReppErrorCode.MysqlError;

function wrap(error, message) {
    if (error instanceof AppError) return error;
    return new AppError(message, 500, { code: ERROR_CODE, details: error });
}

/**
 * Leitura ou escrita no pool, ou numa conexão de transação quando `conn` vem.
 * @returns {Promise<Array|object>} linhas, ou o `ResultSetHeader` numa escrita.
 */
async function query(sql, params = [], conn = poolGlobal) {
    try {
        const [result] = await conn.query(sql, params);
        return result;
    } catch (error) {
        throw wrap(error, 'Erro ao acessar o banco de dados da reserva de espaços.');
    }
}

/**
 * Bloco numa transação, com rollback e release garantidos. AppError lançado
 * pelo bloco (409 de conflito, 404) atravessa intacto, depois do rollback.
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
        throw wrap(error, 'Erro ao gravar a reserva de espaço.');
    } finally {
        conn.release();
    }
}

module.exports = { query, transaction, ERROR_CODE };
