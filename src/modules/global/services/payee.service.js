/**
 * @fileoverview Serviço de Prestadores (Payees).
 *
 * Gerencia o CRUD completo de prestadores de serviço e freelancers (`gipp_payee`),
 * incluindo a proteção contra exclusão de registros com recibos de pagamento vinculados.
 *
 * @module modules/global/services/payee.service
 */

const { poolPromise, sql } = require('../../../config/sqlserver');
const { AppError }         = require('../../../errors/app.error');
const {
    sqlGetPayees,
    sqlInsertPayee,
    sqlUpdatePayee,
    sqlPatchPayee,
    sqlDeletePayee,
    PATCH_PAYEE_FIELDS
} = require('../repositories/sqlserver/payee.repository');

/**
 * Serviço de Prestadores (Payees).
 *
 * Expõe operações de consulta, criação, atualização parcial/completa e remoção de
 * prestadores de serviço, garantindo integridade referencial com recibos de pagamento.
 */
class PayeeService {

    // ─── Consulta ─────────────────────────────────────────────────────────────

    /**
     * Retorna prestadores com filtros dinâmicos opcionais.
     *
     * Os filtros são construídos dinamicamente no repositório; apenas os parâmetros
     * presentes em `filters` são aplicados na query.
     *
     * @param {Object}  filters              - Parâmetros de busca.
     * @param {number}  [filters.id]         - ID exato do prestador.
     * @param {string}  [filters.type]       - Tipo do prestador (ex.: `'freelancer'`, `'pj'`).
     * @param {string}  [filters.name]       - Nome parcial (LIKE).
     * @param {string}  [filters.document]   - CPF/CNPJ (parcial ou completo).
     * @param {0|1}     [filters.is_active]  - 1 = ativo, 0 = inativo.
     * @returns {Promise<Object[]>} Lista de prestadores encontrados.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getPayees(filters) {
        try {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetPayees(filters);
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Error fetching payees',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    // ─── Criação ──────────────────────────────────────────────────────────────

    /**
     * Cadastra um novo prestador de serviço.
     *
     * @param {Object}       payload                         - Dados do prestador.
     * @param {string}       payload.type                    - Tipo (ex.: `'freelancer'`).
     * @param {string}       payload.name                    - Nome completo.
     * @param {string|null}  [payload.document]              - CPF ou CNPJ.
     * @param {string|null}  [payload.email]                 - E-mail de contato.
     * @param {string|null}  [payload.phone]                 - Telefone.
     * @param {boolean}      payload.is_active               - Se deve iniciar ativo.
     * @param {string}       payload.created_by              - Matrícula do criador.
     * @param {string}       payload.created_by_branch_code  - Filial do criador.
     * @returns {Promise<Object>} Prestador criado com ID gerado.
     * @throws {AppError} Em caso de falha na inserção.
     */
    async postPayee(payload) {
        try {
            const pool   = await poolPromise;
            const result = await pool.request()
                .input('type',                   sql.VarChar(20),  payload.type)
                .input('name',                   sql.VarChar(200), payload.name)
                .input('document',               sql.VarChar(20),  payload.document               ?? null)
                .input('email',                  sql.VarChar(100), payload.email                  ?? null)
                .input('phone',                  sql.VarChar(20),  payload.phone                  ?? null)
                .input('is_active',              sql.Bit,          payload.is_active)
                .input('created_by',             sql.VarChar(50),  payload.created_by)
                .input('created_by_branch_code', sql.VarChar(10),  payload.created_by_branch_code)
                .query(sqlInsertPayee());
            return result.recordset[0];
        } catch (error) {
            throw new AppError(
                error.message || 'Error inserting payee',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    // ─── Atualização Completa ─────────────────────────────────────────────────

    /**
     * Substitui completamente os dados de um prestador existente (PUT).
     *
     * @param {Object}       payload                         - Dados atualizados do prestador.
     * @param {number}       payload.id                      - ID do prestador.
     * @param {string}       payload.type                    - Tipo.
     * @param {string}       payload.name                    - Nome completo.
     * @param {string|null}  [payload.document]              - CPF ou CNPJ.
     * @param {string|null}  [payload.email]                 - E-mail.
     * @param {string|null}  [payload.phone]                 - Telefone.
     * @param {boolean}      payload.is_active               - Status ativo/inativo.
     * @param {string}       payload.updated_by              - Matrícula do editor.
     * @param {string}       payload.updated_by_branch_code  - Filial do editor.
     * @returns {Promise<Object>} Prestador após atualização.
     * @throws {AppError} 404 se o prestador não for encontrado.
     * @throws {AppError} 500 para outros erros de banco.
     */
    async putPayee(payload) {
        try {
            const pool   = await poolPromise;
            const result = await pool.request()
                .input('id',                     sql.Int,          payload.id)
                .input('type',                   sql.VarChar(20),  payload.type)
                .input('name',                   sql.VarChar(200), payload.name)
                .input('document',               sql.VarChar(20),  payload.document               ?? null)
                .input('email',                  sql.VarChar(100), payload.email                  ?? null)
                .input('phone',                  sql.VarChar(20),  payload.phone                  ?? null)
                .input('is_active',              sql.Bit,          payload.is_active)
                .input('updated_by',             sql.VarChar(50),  payload.updated_by)
                .input('updated_by_branch_code', sql.VarChar(10),  payload.updated_by_branch_code)
                .query(sqlUpdatePayee());

            if (!result.recordset?.[0]) throw new AppError('Payee not found', 404);
            return result.recordset[0];
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(
                error.message || 'Error updating payee',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    // ─── Atualização Parcial ──────────────────────────────────────────────────

    /**
     * Atualiza parcialmente um prestador (PATCH).
     *
     * Apenas os campos presentes em `fields` são alterados. Os tipos SQL de cada
     * campo são inferidos a partir do mapa `PATCH_PAYEE_FIELDS` do repositório.
     *
     * @param {number} id                   - ID do prestador a ser atualizado.
     * @param {Object} fields               - Objeto com os campos a alterar e seus novos valores.
     * @param {string} updatedBy            - Matrícula do usuário que está editando.
     * @param {string} updatedByBranchCode  - Código da filial do usuário.
     * @returns {Promise<Object>} Prestador após a atualização parcial.
     * @throws {AppError} 400 se nenhum campo for enviado.
     * @throws {AppError} 404 se o prestador não for encontrado.
     * @throws {AppError} 500 para outros erros de banco.
     */
    async patchPayee(id, fields, updatedBy, updatedByBranchCode) {
        try {
            const fieldNames = Object.keys(fields);

            if (!fieldNames.length) throw new AppError('No fields provided to update', 400);

            const pool    = await poolPromise;
            const request = pool.request();

            // ID e auditoria — sempre presentes
            request.input('id',                    sql.Int,         id);
            request.input('updated_by',            sql.VarChar(50), updatedBy);
            request.input('updated_by_branch_code',sql.VarChar(10), updatedByBranchCode);

            // Campos dinâmicos com tipo SQL inferido pelo mapa do repositório
            for (const field of fieldNames) {
                const sqlType = PATCH_PAYEE_FIELDS[field];
                if (sqlType === 'Bit') request.input(field, sql.Bit,     fields[field]);
                else                   request.input(field, sql.VarChar, fields[field]);
            }

            const result = await request.query(sqlPatchPayee(fieldNames));
            if (!result.recordset?.[0]) throw new AppError('Payee not found', 404);
            return result.recordset[0];
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(
                error.message || 'Error patching payee',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    // ─── Exclusão ─────────────────────────────────────────────────────────────

    /**
     * Remove um prestador permanentemente do banco de dados.
     *
     * Antes de excluir, verifica:
     * 1. Se o prestador existe em `gipp_payee`.
     * 2. Se não há recibos de pagamento ativos vinculados a ele em `gipp_payment_receipt`.
     *    Prestadores com recibos vinculados não podem ser excluídos (integridade referencial).
     *
     * @param {number} id - ID do prestador a ser removido.
     * @returns {Promise<{deleted: true}>} Objeto de confirmação.
     * @throws {AppError} 404 se o prestador não for encontrado.
     * @throws {AppError} 409 se houver recibos de pagamento ativos vinculados ao prestador.
     * @throws {AppError} 500 para outros erros de banco.
     */
    async deletePayee(id) {
        try {
            const pool = await poolPromise;

            // 1 — Verifica se o prestador existe
            const check = await pool.request()
                .input('id', sql.Int, id)
                .query('SELECT id FROM GIPP.dbo.gipp_payee WHERE id = @id');

            if (!check.recordset?.[0]) throw new AppError('Payee not found', 404);

            // 2 — Bloqueia exclusão se houver recibos de pagamento ativos vinculados
            const linked = await pool.request()
                .input('id', sql.Int, id)
                .query('SELECT TOP 1 id FROM GIPP.dbo.gipp_payment_receipt WHERE payee_id = @id AND is_active = 1');

            if (linked.recordset?.[0]) {
                throw new AppError('Cannot delete payee with linked payment receipts', 409);
            }

            // 3 — Executa a exclusão
            await pool.request()
                .input('id', sql.Int, id)
                .query(sqlDeletePayee());

            return { deleted: true };
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(
                error.message || 'Error deleting payee',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }
}

module.exports = { PayeeService };
