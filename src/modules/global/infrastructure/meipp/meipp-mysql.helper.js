/**
 * @fileoverview Acesso ao `poolGlobal` compartilhado pelos adapters do meipp.
 *
 * Os oito adapters da suite repetiriam o mesmo try/catch de tradução de erro;
 * concentrá-lo aqui garante que nenhum deles deixe escapar mensagem crua do
 * MySQL para o cliente (nome de coluna, SQL, host) — o `AppError` leva o
 * detalhe, e o `error.middleware` decide o que sai na resposta.
 *
 * @module modules/global/infrastructure/meipp/meipp-mysql.helper
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');

/** Prefixo de `code` nos erros do módulo, para filtrar no log. */
const ERROR_CODE = 'MEIPP_MYSQL_ERROR';

/**
 * Executa uma leitura no `poolGlobal`.
 *
 * Usa `pool.query()` e não `pool.execute()`, acompanhando o resto dos adapters
 * do módulo global. A diferença importa aqui: as listagens do meipp usam
 * `LIMIT ?` e o padrão `(? IS NULL OR coluna = ?)`, e ambos tropeçam no
 * protocolo de statement preparado do `execute()` (o LIMIT exige inteiro
 * bindado como inteiro; o `? IS NULL` chega sem tipo definido). O `query()`
 * escapa os parâmetros do lado do cliente, então continua parametrizado —
 * nenhuma string de usuário é concatenada em SQL em lugar nenhum da suite.
 *
 * @param {string} sql
 * @param {Array}  [params]
 * @returns {Promise<Array>} linhas.
 */
async function query(sql, params = []) {
    try {
        const [rows] = await poolGlobal.query(sql, params);
        return rows;
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('Erro ao acessar o banco de dados do meipp.', 500, {
            code: ERROR_CODE,
            details: error,
        });
    }
}

/**
 * Executa uma escrita e devolve o `ResultSetHeader` (`insertId`, `affectedRows`).
 *
 * @param {string} sql
 * @param {Array}  [params]
 * @returns {Promise<object>}
 */
async function execute(sql, params = []) {
    try {
        const [result] = await poolGlobal.query(sql, params);
        return result;
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('Erro ao gravar no banco de dados do meipp.', 500, {
            code: ERROR_CODE,
            details: error,
        });
    }
}

/**
 * Roda um bloco dentro de uma transação, com rollback e release garantidos.
 *
 * O `conn.release()` do `config/mysql` já vira `destroy()` quando a query
 * estourou o timeout — não é preciso tratar isso aqui.
 *
 * @param {(conn: object) => Promise<*>} run
 * @returns {Promise<*>} o que `run` devolver.
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
        if (error instanceof AppError) throw error;
        throw new AppError('Erro ao gravar no banco de dados do meipp.', 500, {
            code: ERROR_CODE,
            details: error,
        });
    } finally {
        conn.release();
    }
}

/**
 * Lê `COUNT(*) AS total` de uma query de contagem.
 *
 * @param {string} sql
 * @param {Array}  [params]
 * @returns {Promise<number>}
 */
async function count(sql, params = []) {
    const rows = await query(sql, params);
    return Number(rows[0]?.total ?? 0);
}

/**
 * Normaliza uma coluna JSON lida do banco.
 *
 * O driver devolve colunas JSON ora já desserializadas, ora como string,
 * dependendo da versão do servidor e do tipo declarado. Sem normalizar na
 * borda, o mesmo campo sai ora objeto, ora string, na resposta HTTP.
 *
 * @param {*} value
 * @returns {object|null} `null` também quando o conteúdo não é JSON válido.
 */
function parseJsonColumn(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

module.exports = { query, execute, transaction, count, parseJsonColumn, ERROR_CODE };
