/**
 * @fileoverview Serviço de RH do GIPP.
 *
 * Centraliza toda a lógica de negócio relacionada a compensações, beneficiários,
 * colaboradores paginados, recibos de pagamento e geração de PDF de recibos.
 *
 * @module modules/global/services/gipp-rh.service
 */

const { poolPromise, sql } = require('../../../config/sqlserver');
const { AppError } = require('../../../errors/app.error');

const {
    sqlGetBeneficiariesByEmployee,
    sqlGetReceiptsByGroupIds,
    sqlEmployeesCompensations,
    sqlActiveBeneficiaries,
    sqlInsertCompensation,
    sqlUpdateCompensation,
    sqlGetEmployeesPaginated,
    sqlGetReceipt,
    sqlGetEventCodes,
    sqlInsertPaymentReceipt,
    sqlGetPaymentReceipts,
    sqlUpdatePaymentReceipt,
    sqlPatchPaymentReceipt,
    sqlGetPaymentTypes,
    PATCH_RECEIPT_FIELDS
} = require('../repositories/sqlserver/gipp-rh.repository');

/**
 * Serviço de RH do GIPP.
 *
 * Expõe operações sobre compensações, beneficiários, colaboradores e recibos de pagamento.
 * Cada método instancia a conexão via `poolPromise` e encapsula os erros como `AppError`.
 */
class GippRhService {

    /**
     * Cria uma instância do serviço.
     * @param {number} [id=0] - Identificador opcional (reservado para uso futuro).
     */
    constructor(id = 0) {
        this.id = id;
    }

    // ─── Compensações ─────────────────────────────────────────────────────────

    /**
     * Retorna todas as compensações ativas cadastradas.
     *
     * @returns {Promise<Object[]>} Lista de compensações ativas.
     * @throws {AppError} Em caso de falha na consulta ao banco.
     */
    async getActiveCompensations() {
        try {
            const pool = await poolPromise;
            const result = await pool.request().query(sqlEmployeesCompensations());
            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Erro ao buscar compensações',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    /**
     * Cria uma nova compensação.
     *
     * @param {Object} payload                    - Dados da compensação.
     * @param {string} payload.name               - Nome da compensação.
     * @param {string} payload.description        - Descrição detalhada.
     * @param {boolean|string} payload.active     - Indica se está ativa (`true`/`'true'`).
     * @param {string} payload.created_by         - Matrícula do usuário criador.
     * @param {string} payload.created_by_branch  - Código da filial do criador.
     * @returns {Promise<Object>} Compensação recém-criada (registro com ID gerado).
     * @throws {AppError} Em caso de falha na inserção.
     */
    async postCompensations(payload) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('name',               sql.VarChar, payload.name)
                .input('description',        sql.VarChar, payload.description)
                .input('active',             sql.Bit,     payload.active === 'true' || payload.active === true)
                .input('created_by',         sql.VarChar, payload.created_by)
                .input('created_by_branch',  sql.VarChar, payload.created_by_branch)
                .query(sqlInsertCompensation());
            return result.recordset[0];
        } catch (error) {
            throw new AppError(
                error.message || 'Error inserting compensation',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    /**
     * Associa um colaborador a uma compensação (beneficiário), via stored procedure.
     *
     * @param {Object} payload                - Dados do beneficiário.
     * @param {string} payload.employee_id    - Matrícula/código do colaborador.
     * @param {number} payload.compensation_id - ID da compensação.
     * @param {number} payload.value          - Valor da compensação.
     * @param {string} payload.branch_code    - Código da filial.
     * @param {string} payload.start_date     - Data de início (ISO 8601).
     * @param {string} payload.created_by     - Matrícula do criador.
     * @param {string} payload.updated_by     - Matrícula do atualizador.
     * @returns {Promise<Object>} Resultado da procedure ou objeto vazio se sem retorno.
     * @throws {AppError} Em caso de falha na execução da procedure.
     */
    async postBeneficiary(payload) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('employee_id',      sql.VarChar,        payload.employee_id)
                .input('compensation_id',  sql.Int,            payload.compensation_id)
                .input('value',            sql.Decimal(18, 2), payload.value)
                .input('branch_code',      sql.VarChar,        payload.branch_code)
                .input('start_date',       sql.Date,           payload.start_date)
                .input('created_by',       sql.VarChar,        payload.created_by)
                .input('updated_by',       sql.VarChar,        payload.updated_by)
                .execute('sp_gipp_insert_employee_compensation');
            return result.recordset?.[0] || {};
        } catch (error) {
            throw new AppError(
                error.message || 'Error inserting beneficiary',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    /**
     * Atualiza os dados de um beneficiário existente, via stored procedure.
     *
     * Internamente chama a mesma `sp_gipp_insert_employee_compensation` com o campo `id`
     * preenchido para acionar o fluxo de atualização dentro da procedure.
     *
     * @param {Object} payload                - Dados atualizados do beneficiário.
     * @param {number} payload.id             - ID do registro a ser atualizado.
     * @param {string} payload.employee_id    - Matrícula/código do colaborador.
     * @param {number} payload.compensation_id - ID da compensação.
     * @param {number} payload.value          - Novo valor da compensação.
     * @param {string} payload.branch_code    - Código da filial.
     * @param {string} payload.start_date     - Data de início (ISO 8601).
     * @param {string} payload.created_by     - Matrícula do criador original.
     * @param {string} payload.updated_by     - Matrícula de quem está atualizando.
     * @returns {Promise<Object>} Registro atualizado ou objeto vazio.
     * @throws {AppError} Em caso de falha na execução da procedure.
     */
    async putBeneficiary(payload) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id',               sql.Int,            payload.id)
                .input('employee_id',      sql.VarChar,        payload.employee_id)
                .input('compensation_id',  sql.Int,            payload.compensation_id)
                .input('value',            sql.Decimal(18, 2), payload.value)
                .input('branch_code',      sql.VarChar,        payload.branch_code)
                .input('start_date',       sql.Date,           payload.start_date)
                .input('created_by',       sql.VarChar,        payload.created_by)
                .input('updated_by',       sql.VarChar,        payload.updated_by)
                .execute('sp_gipp_insert_employee_compensation');
            return result.recordset?.[0] || {};
        } catch (error) {
            throw new AppError(
                error.message || 'Error inserting beneficiary',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    // ─── Colaboradores ────────────────────────────────────────────────────────

    /**
     * Retorna colaboradores com suporte a paginação e filtros dinâmicos.
     *
     * @param {Object}  filters               - Parâmetros de busca e paginação.
     * @param {number}  [filters.page=1]      - Número da página (base 1).
     * @param {number}  [filters.pageSize=50] - Quantidade de registros por página.
     * @param {string}  [filters.name]        - Filtro parcial pelo nome do colaborador.
     * @param {string}  [filters.costCenter]  - Código do centro de custo.
     * @param {string}  [filters.branch]      - Código da filial.
     * @param {string}  [filters.cnpj]        - CNPJ da empresa.
     * @param {string}  [filters.status]      - Status do colaborador (`'A'` ativo, `'I'` inativo, etc.).
     * @returns {Promise<Object[]>} Lista paginada de colaboradores.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getEmployeesPaginated(filters) {
        try {
            const pool   = await poolPromise;
            const result = await pool.request()
                .input('PageNumber',    sql.Int,       filters.page       || 1)
                .input('PageSize',      sql.Int,       filters.pageSize   || 50)
                .input('EmployeeName',  sql.NVarChar,  filters.name       || null)
                .input('CostCenterCode',sql.NVarChar,  filters.costCenter || null)
                .input('BranchCode',    sql.NVarChar,  filters.branch     || null)
                .input('CompanyCNPJ',   sql.NVarChar,  filters.cnpj       || null)
                .input('Status',        sql.Char,      filters.status     || null)
                .query(sqlGetEmployeesPaginated());

            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Erro ao buscar colaboradores paginados',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    // ─── Compensações (atualização) ───────────────────────────────────────────

    /**
     * Atualiza uma compensação existente via stored procedure.
     *
     * @param {Object} payload               - Dados atualizados da compensação.
     * @param {number} payload.id            - ID da compensação.
     * @param {string} payload.name          - Novo nome.
     * @param {string} payload.description   - Nova descrição.
     * @param {boolean} payload.active       - Status ativo/inativo.
     * @param {string} payload.user_code     - Matrícula do usuário que está editando.
     * @param {string} payload.branch_code   - Código da filial do usuário.
     * @returns {Promise<Object>} Compensação atualizada.
     * @throws {AppError} Em caso de falha na execução da procedure.
     */
    async putCompensations(payload) {
        try {
            const pool   = await poolPromise;
            const result = await pool.request()
                .input('id',           sql.Int,     payload.id)
                .input('name',         sql.VarChar, payload.name)
                .input('description',  sql.VarChar, payload.description)
                .input('active',       sql.Bit,     payload.active)
                .input('user_code',    sql.VarChar, payload.user_code)
                .input('user_branch',  sql.VarChar, payload.branch_code)
                .execute(sqlUpdateCompensation());
            return result.recordset[0];
        } catch (error) {
            throw new AppError(
                error.message || 'Error updating compensation',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    // ─── Beneficiários ────────────────────────────────────────────────────────

    /**
     * Retorna todos os beneficiários ativos com suas compensações vinculadas.
     *
     * @returns {Promise<Object[]>} Lista de beneficiários ativos.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getActiveBeneficiaries() {
        try {
            const pool   = await poolPromise;
            const result = await pool.request().query(sqlActiveBeneficiaries());
            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Error when entering compensation',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    // ─── Recibos / PDF ────────────────────────────────────────────────────────

    /**
     * Busca os dados necessários para gerar o recibo de um colaborador (CLT) ou prestador.
     *
     * O resultado é um array de objetos JSON desserializados retornados pela query via
     * `FOR JSON PATH`. Cada objeto representa um grupo de recibo pronto para renderização.
     *
     * @param {string|null} employeeCode    - Matrícula do colaborador CLT (ou `null`).
     * @param {string}      branchCode      - Código da filial.
     * @param {string}      referenceInit   - Referência inicial no formato `YYYYMM`.
     * @param {string}      referenceEnd    - Referência final no formato `YYYYMM`.
     * @param {number|null} [payeeId=null]  - ID do prestador (`gipp_payee.id`) ou `null`.
     * @returns {Promise<Object[]>} Array de grupos de recibo ou `[]` se não houver dados.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getReceiptData(employeeCode, branchCode, referenceInit, referenceEnd, payeeId = null) {
        try {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetBeneficiariesByEmployee(
                employeeCode, branchCode, referenceInit, referenceEnd, payeeId
            );
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(query);

            if (!result.recordset?.length) return [];

            const key = Object.keys(result.recordset[0])[0];
            return JSON.parse(result.recordset[0][key] || '[]');
        } catch (error) {
            throw new AppError(
                error.message || 'Error when fetching receipt data',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    /**
     * Busca os dados de recibos a partir de uma lista de `receipt_group_id`.
     *
     * Utilizado pela rota unificada de download de recibos. O retorno é desserializado
     * do JSON produzido por `FOR JSON PATH` na query de repositório.
     *
     * @param {string[]} groupIds - Array de UUIDs (`receipt_group_id`) a consultar.
     * @returns {Promise<Object[]>} Array de grupos de recibo ou `[]` se não houver dados.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getReceiptsByGroupIds(groupIds) {
        try {
            if (!groupIds?.length) return [];

            const pool = await poolPromise;
            const { sql: query, params } = sqlGetReceiptsByGroupIds(groupIds);
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(query);

            if (!result.recordset?.length) return [];

            const key = Object.keys(result.recordset[0])[0];
            return JSON.parse(result.recordset[0][key] || '[]');
        } catch (error) {
            throw new AppError(
                error.message || 'Error when fetching receipts by group ids',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    // ─── Event Codes e Tipos de Pagamento ─────────────────────────────────────

    /**
     * Retorna todos os códigos de evento disponíveis para lançamento de recibos.
     *
     * @returns {Promise<Object[]>} Lista de event codes.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getEventCodes() {
        try {
            const pool   = await poolPromise;
            const result = await pool.request().query(sqlGetEventCodes());
            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Error fetching event codes',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    /**
     * Retorna todos os tipos de pagamento disponíveis (`gipp_payment_types`).
     *
     * @returns {Promise<Object[]>} Lista de tipos de pagamento.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getPaymentTypes() {
        try {
            const pool   = await poolPromise;
            const result = await pool.request().query(sqlGetPaymentTypes());
            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Error fetching payment types',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    // ─── CRUD de Recibos de Pagamento ─────────────────────────────────────────

    /**
     * Insere um novo recibo de pagamento em `gipp_payment_receipt`.
     *
     * Aceita tanto colaboradores CLT (`employee_code`) quanto prestadores (`payee_id`).
     * Pelo menos um dos dois deve ser informado.
     *
     * @param {Object}       payload                        - Dados do recibo.
     * @param {string}       payload.company_code           - Código da empresa (até 10 chars).
     * @param {string}       payload.branch_code            - Código da filial (até 10 chars).
     * @param {string|null}  [payload.employee_code]        - Matrícula CLT (ou `null`).
     * @param {number|null}  [payload.payee_id]             - ID do prestador (ou `null`).
     * @param {string}       payload.employee_name          - Nome do colaborador/prestador.
     * @param {string}       payload.branch_name            - Nome da filial.
     * @param {string|null}  [payload.work_schedule_id]     - ID da jornada de trabalho.
     * @param {string}       payload.reference              - Referência `YYYYMM`.
     * @param {string}       payload.description            - Descrição do lançamento.
     * @param {number}       payload.amount                 - Valor monetário.
     * @param {string}       payload.movement_type          - `'E'` (entrada) ou `'S'` (saída).
     * @param {boolean}      payload.is_active              - Indica se o recibo está ativo.
     * @param {string|null}  [payload.receipt_group_id]     - UUID do grupo de recibo.
     * @param {string|null}  [payload.event_code]           - Código do evento (ex: `'N|uuid'`).
     * @param {number|null}  [payload.payment_type_id]      - ID do tipo de pagamento.
     * @param {string}       payload.created_by             - Matrícula do criador.
     * @param {string}       payload.created_by_branch_code - Código da filial do criador.
     * @returns {Promise<Object>} Recibo inserido com ID gerado.
     * @throws {AppError} 400 se nem `employee_code` nem `payee_id` for informado.
     * @throws {AppError} 409 em violação de índice único (event_code duplicado no grupo).
     * @throws {AppError} 500 para outros erros de banco.
     */
    async postPaymentReceipt(payload) {
        if (!payload.employee_code && !payload.payee_id) {
            throw new AppError("Informe 'employee_code' (CLT) ou 'payee_id' (prestador).", 400);
        }

        try {
            const pool   = await poolPromise;
            const result = await pool.request()
                .input('company_code',          sql.VarChar(10),    payload.company_code)
                .input('branch_code',            sql.VarChar(10),    payload.branch_code)
                .input('employee_code',          sql.VarChar(20),    payload.employee_code       ?? null)
                .input('payee_id',               sql.Int,            payload.payee_id            ?? null)
                .input('employee_name',          sql.VarChar(200),   payload.employee_name?.toUpperCase())
                .input('branch_name',            sql.VarChar(200),   payload.branch_name?.toUpperCase())
                .input('work_schedule_id',       sql.VarChar(50),    payload.work_schedule_id    ?? null)
                .input('reference',              sql.VarChar(6),     payload.reference)
                .input('reference_date',         sql.Date,           payload.reference_date ? new Date(payload.reference_date) : null)
                .input('description',            sql.VarChar(500),   payload.description)
                .input('amount',                 sql.Decimal(18, 2), payload.amount)
                .input('movement_type',          sql.Char(1),        payload.movement_type)
                .input('is_active',              sql.Bit,            payload.is_active)
                .input('receipt_group_id',       sql.VarChar(50),    payload.receipt_group_id    ?? null)
                .input('event_code',             sql.VarChar(50),    payload.event_code          ?? null)
                .input('payment_type_id',        sql.Int,            payload.payment_type_id     ?? null)
                .input('created_by',             sql.VarChar(50),    payload.created_by)
                .input('created_by_branch_code', sql.VarChar(10),    payload.created_by_branch_code)
                .query(sqlInsertPaymentReceipt());
            return result.recordset[0];
        } catch (error) {
            // Violação de índice único — combinação employee/branch/reference/group/event já existe
            if (error.number === 2601 || error.number === 2627) {
                throw new AppError(
                    'A record with this event_code already exists in this receipt group. Use a different event_code or receipt_group_id.',
                    409
                );
            }
            throw new AppError(
                error.message || 'Error inserting payment receipt',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    /**
     * Consulta recibos de pagamento com filtros dinâmicos opcionais.
     *
     * Todos os parâmetros são opcionais; a query aplica apenas os que forem fornecidos.
     *
     * @param {Object}  filters                    - Filtros de busca.
     * @param {number}  [filters.id]               - ID exato do recibo.
     * @param {string}  [filters.employee_code]    - Matrícula do colaborador.
     * @param {string}  [filters.branch_code]      - Código da filial.
     * @param {string}  [filters.reference]        - Referência `YYYYMM`.
     * @param {string}  [filters.description]      - Descrição parcial (LIKE).
     * @param {number}  [filters.amount]           - Valor exato.
     * @param {string}  [filters.movement_type]    - `'E'` ou `'S'`.
     * @param {0|1}     [filters.is_active]        - 1 = ativo, 0 = inativo.
     * @param {number}  [filters.payment_type_id]  - Tipo de pagamento.
     * @param {string}  [filters.work_schedule_id] - ID da jornada de trabalho.
     * @returns {Promise<Object[]>} Lista de recibos encontrados.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getPaymentReceipts(filters) {
        try {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetPaymentReceipts(filters);
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Error fetching payment receipts',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    /**
     * Substitui completamente os campos editáveis de um recibo existente (PUT).
     *
     * @param {Object}       payload                         - Novos valores do recibo.
     * @param {number}       payload.id                      - ID do recibo a atualizar.
     * @param {string}       payload.description             - Nova descrição.
     * @param {number}       payload.amount                  - Novo valor.
     * @param {string}       payload.movement_type           - `'E'` ou `'S'`.
     * @param {boolean}      payload.is_active               - Ativo ou inativo.
     * @param {string|null}  [payload.event_code]            - Novo event code.
     * @param {string|null}  [payload.work_schedule_id]      - Novo ID de jornada.
     * @param {number|null}  [payload.payment_type_id]       - Novo tipo de pagamento.
     * @param {string}       payload.updated_by              - Matrícula do editor.
     * @param {string}       payload.updated_by_branch_code  - Filial do editor.
     * @returns {Promise<Object>} Recibo atualizado.
     * @throws {AppError} 404 se o recibo não for encontrado.
     * @throws {AppError} 500 para outros erros de banco.
     */
    async putPaymentReceipt(payload) {
        try {
            const pool   = await poolPromise;
            const result = await pool.request()
                .input('id',                     sql.Int,            payload.id)
                .input('description',            sql.VarChar(500),   payload.description)
                .input('amount',                 sql.Decimal(18, 2), payload.amount)
                .input('movement_type',          sql.Char(1),        payload.movement_type)
                .input('is_active',              sql.Bit,            payload.is_active)
                .input('reference_date',         sql.Date,           payload.reference_date ? new Date(payload.reference_date) : null)
                .input('event_code',             sql.VarChar(50),    payload.event_code           ?? null)
                .input('work_schedule_id',       sql.VarChar(50),    payload.work_schedule_id     ?? null)
                .input('payment_type_id',        sql.Int,            payload.payment_type_id      ?? null)
                .input('updated_by',             sql.VarChar(50),    payload.updated_by)
                .input('updated_by_branch_code', sql.VarChar(10),    payload.updated_by_branch_code)
                .query(sqlUpdatePaymentReceipt());

            if (!result.recordset?.[0]) {
                throw new AppError('Payment receipt not found', 404);
            }

            return result.recordset[0];
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(
                error.message || 'Error updating payment receipt',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    /**
     * Atualiza parcialmente um recibo de pagamento (PATCH).
     *
     * Apenas os campos presentes em `fields` são atualizados. Os tipos SQL de cada
     * campo são inferidos a partir do mapa `PATCH_RECEIPT_FIELDS` do repositório.
     *
     * @param {number} id                      - ID do recibo a ser atualizado.
     * @param {Object} fields                  - Objeto com os campos a alterar e seus novos valores.
     * @param {string} updatedBy               - Matrícula do usuário que está editando.
     * @param {string} updatedByBranchCode     - Código da filial do usuário.
     * @returns {Promise<Object>} Recibo após a atualização parcial.
     * @throws {AppError} 400 se nenhum campo for enviado.
     * @throws {AppError} 404 se o recibo não for encontrado.
     * @throws {AppError} 500 para outros erros de banco.
     */
    async patchPaymentReceipt(id, fields, updatedBy, updatedByBranchCode) {
        try {
            const fieldNames = Object.keys(fields);

            if (!fieldNames.length) {
                throw new AppError('No fields provided to update', 400);
            }

            const pool    = await poolPromise;
            const request = pool.request();

            // ID e auditoria — sempre presentes
            request.input('id',                    sql.Int,         id);
            request.input('updated_by',            sql.VarChar(50), updatedBy);
            request.input('updated_by_branch_code',sql.VarChar(10), updatedByBranchCode);

            // Apenas os campos enviados pelo cliente, com o tipo SQL correto
            for (const field of fieldNames) {
                const sqlType = PATCH_RECEIPT_FIELDS[field];
                if (sqlType === 'Decimal')    request.input(field, sql.Decimal(18, 2), fields[field]);
                else if (sqlType === 'Int')   request.input(field, sql.Int,           fields[field]);
                else if (sqlType === 'Bit')   request.input(field, sql.Bit,           fields[field]);
                else if (sqlType === 'Char')  request.input(field, sql.Char(1),       fields[field]);
                else if (sqlType === 'Date')  request.input(field, sql.Date,          fields[field] ? new Date(fields[field]) : null);
                else                          request.input(field, sql.VarChar,       fields[field]);
            }

            const result = await request.query(sqlPatchPaymentReceipt(fieldNames));

            if (!result.recordset?.[0]) {
                throw new AppError('Payment receipt not found', 404);
            }

            return result.recordset[0];
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(
                error.message || 'Error patching payment receipt',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }

    /**
     * Retorna recibos consolidados para exibição em tela (não PDF), com filtros por
     * colaborador, filial, intervalo de referência e tipo de pagamento.
     *
     * @param {string|null} employeeCode    - Matrícula do colaborador (ou `null`).
     * @param {string}      branchCode      - Código da filial.
     * @param {string}      referenceInit   - Referência inicial `YYYYMM`.
     * @param {string}      referenceEnd    - Referência final `YYYYMM`.
     * @param {number|null} paymentTypeId   - ID do tipo de pagamento (ou `null` para todos).
     * @returns {Promise<Object[]>} Lista de recibos encontrados.
     * @throws {AppError} Em caso de falha na consulta.
     */
    async getReceipt(employeeCode, branchCode, referenceInit, referenceEnd, paymentTypeId, dateFrom, dateTo) {
        try {
            const pool = await poolPromise;
            const { sql: query, params } = sqlGetReceipt(
                employeeCode, branchCode, referenceInit, referenceEnd, paymentTypeId, dateFrom, dateTo
            );
            const request = pool.request();
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            throw new AppError(
                error.message || 'Error when entering compensation',
                500,
                error.code || 'SQLSERVER_ERROR',
                error
            );
        }
    }
}

module.exports = { GippRhService };
