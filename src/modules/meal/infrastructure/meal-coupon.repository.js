/**
 * @fileoverview Adapter — implementa `MealCouponRepositoryPort`.
 *
 * Único repositório do módulo que fala com DUAS fontes, e o nome não traz
 * prefixo de banco por isso. A divisão é de responsabilidade, não de capricho:
 * o **Consinco (Oracle)** é a autoridade sobre a venda ter acontecido; o
 * **GIPP (SQL Server)** é a autoridade sobre o cupom já ter sido usado. Nenhum
 * dos dois responde a pergunta do outro, e juntar os dois atrás de um contrato
 * é o que deixa o caso de uso testável sem banco nenhum.
 *
 * O Oracle aqui é SÓ LEITURA. Nada do refeitório escreve no ERP.
 *
 * @module modules/meal/infrastructure/meal-coupon.repository
 */

const { poolPromise, sql } = require('../../../config/sqlserver');
const { oracleQuery } = require('../../../config/oracle');
const { AppError } = require('../../../errors/app.error');
const { MealCouponRepositoryPort } = require('../application/ports/meal-coupon-repository.port');
const { sqlFindCouponMealItem } = require('../repositories/oracle/meal-coupon.queries');
const {
    sqlFindPosSiteByCnpj,
    sqlGetCouponBalance,
    sqlRedeemCoupon,
    sqlLinkCouponToMealLog,
} = require('../repositories/sqlserver/meal-coupon.queries');
const { sqlInsertMealLog } = require('../repositories/sqlserver/meal.queries');

/** Violação de unicidade no SQL Server. */
const UNIQUE_VIOLATION_CODES = new Set([2601, 2627]);

/** Violação de CHECK ou FK. `CK_meal_coupon_seq` chega por aqui. */
const CONSTRAINT_VIOLATION_CODE = 547;

class MealCouponRepository extends MealCouponRepositoryPort {
    /**
     * Mesma política do resto do módulo: o texto cru do banco nunca sai para
     * quem chamou, porque expõe nome de objeto e estrutura interna.
     * @private
     */
    async _run(fn, fallbackMessage) {
        try {
            return await fn();
        } catch (error) {
            if (error instanceof AppError) throw error;

            console.error('[meal-coupon.repository]', error);
            throw new AppError(fallbackMessage, 500, { code: 'MEAL_COUPON_DB_ERROR' });
        }
    }

    // ─── SQL Server: de qual loja é o CNPJ ──────────────────────────────────

    async findPosSiteByCnpj(cnpj) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('cnpj', sql.Char(14), String(cnpj))
                .query(sqlFindPosSiteByCnpj());

            const row = result.recordset[0];
            if (!row) return null;

            return {
                /* Devolvido a partir do que foi consultado, não do que veio do
                   banco: a coluna `M0_CGC` pode estar mascarada, e quem chamou
                   precisa do mesmo formato numérico da chave da NFC-e. */
                cnpj: String(cnpj),
                site_code: String(row.site_code).trim(),
                label: String(row.label).trim(),
            };
        }, 'Não foi possível identificar a loja do cupom.');
    }

    // ─── Oracle: a venda existe? ────────────────────────────────────────────

    async findCouponInConsinco({ cnpj, serie, numerodf, seqproduto, from, to }) {
        return this._run(async () => {
            const digits = String(cnpj).replace(/\D/g, '');

            const rows = await oracleQuery(sqlFindCouponMealItem(), {
                /* `GE_EMPRESA` guarda o CNPJ partido: 12 dígitos em `NROCGC` e
                   os 2 verificadores em `DIGCGC`. Como as colunas são numéricas,
                   os binds vão como número — `Number()` também descarta zeros à
                   esquerda, que é o comportamento certo aqui: um CNPJ começando
                   em 0 está gravado sem ele do lado do Oracle. */
                nrocgc: Number(digits.slice(0, 12)),
                digcgc: Number(digits.slice(12, 14)),
                /* Mesma razão para o número da nota: a chave da NFC-e traz
                   `000371116`, e mandar como texto força conversão implícita no
                   Oracle e descarta o índice. */
                seriedf: String(serie),
                numerodf: Number(numerodf),
                seqproduto: Number(seqproduto),
                desde: from,
                ate: to,
            });

            if (rows.length === 0) return null;

            /* `LEFT JOIN`: com o item ausente vem uma linha só, com SEQPRODUTO
               nulo. Com o item presente pode vir mais de uma (o mesmo produto
               lançado em itens separados no cupom), e aí a quantidade é a soma —
               quatro almoços podem estar como 4x1 em vez de 1x4. */
            const withItem = rows.filter(r => r.SEQPRODUTO !== null && r.SEQPRODUTO !== undefined);
            const head = rows[0];

            if (withItem.length === 0) {
                return {
                    nroempresa: Number(head.NROEMPRESA),
                    dtamovimento: head.DTAMOVIMENTO,
                    seqproduto: null,
                    quantidade: null,
                    vlritem: null,
                };
            }

            return {
                nroempresa: Number(head.NROEMPRESA),
                dtamovimento: head.DTAMOVIMENTO,
                seqproduto: Number(withItem[0].SEQPRODUTO),
                quantidade: withItem.reduce((total, r) => total + Number(r.QUANTIDADE || 0), 0),
                /* Valor pago pelo almoço. Não entra em nenhuma validação — é
                   para o relatório de receita, que é o que a venda a prestador
                   gera e o rateio de centro de custo não sabe contar. */
                vlritem: withItem.reduce((total, r) => total + Number(r.VLRITEM || 0), 0),
            };
        }, 'Não foi possível consultar o cupom no Consinco.');
    }

    // ─── SQL Server: quanto já foi usado ────────────────────────────────────

    async getCouponBalance(nfeKey) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('nfe_key', sql.Char(44), String(nfeKey))
                .query(sqlGetCouponBalance());

            const row = result.recordset[0];
            if (!row) return null;

            return {
                meals_authorized: Number(row.meals_authorized),
                meals_redeemed: Number(row.meals_redeemed),
                site_code: String(row.site_code).trim(),
                coupon_date: row.coupon_date,
                tp_emis: String(row.tp_emis),
            };
        }, 'Não foi possível consultar o saldo do cupom.');
    }

    // ─── SQL Server: consumir e servir, indivisível ─────────────────────────

    /**
     * Transação explícita, e as três etapas nesta ordem por um motivo cada:
     *
     *   1. `meal_coupon` primeiro — é o recurso escasso. Se o saldo acabou, nada
     *      mais aconteceu e não há o que desfazer.
     *   2. `meal_log` depois — a refeição só existe se o saldo foi debitado.
     *   3. o vínculo por último — precisa dos dois ids.
     *
     * Gravar na ordem inversa liberaria almoço sem debitar o cupom no intervalo
     * entre as duas gravações, que é exatamente o que a tabela de saldo existe
     * para impedir.
     */
    async redeemCouponWithMealLog(coupon, mealLog) {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);

        await transaction.begin();

        /* UM instante para as duas tabelas. `meal_coupon.redeemed_at` e
           `meal_log.served_at` descrevem o mesmo ato — se cada um pegar o
           próprio relógio, a auditoria acha dois eventos onde houve um. */
        const stampedAt = new Date();

        try {
            // 1. Debita o saldo.
            const redeemed = await new sql.Request(transaction)
                .input('nfe_key', sql.Char(44), coupon.nfe_key)
                .input('meals_authorized', sql.SmallInt, coupon.meals_authorized)
                .input('site_code', sql.Char(4), coupon.site_code)
                .input('coupon_date', sql.Date, coupon.coupon_date)
                .input('service_date', sql.Date, coupon.service_date)
                .input('seqproduto', sql.Int, coupon.seqproduto)
                .input('tp_emis', sql.Char(1), coupon.tp_emis)
                .input('operator_user_id', sql.Int, coupon.operator_user_id ?? null)
                .query(sqlRedeemCoupon());

            const couponRow = redeemed.recordset[0];

            if (!couponRow) {
                throw new AppError('Não foi possível debitar o cupom.', 500, {
                    code: 'COUPON_REDEEM_EMPTY',
                });
            }

            // 2. Registra a refeição.
            const logResult = await new sql.Request(transaction)
                .input('diner_type', sql.TinyInt, mealLog.diner_type)
                .input('company_code', sql.VarChar(10), null)
                .input('employee_id', sql.VarChar(6), null)
                .input('branch_code', sql.VarChar(10), null)
                .input('diner_group_id', sql.Int, null)
                .input('host_company_code', sql.VarChar(10), null)
                .input('host_employee_id', sql.VarChar(6), null)
                .input('host_branch_code', sql.VarChar(10), null)
                .input('guest_label', sql.VarChar(80), null)
                .input('cost_center', sql.VarChar(9), null)
                .input('site_code', sql.VarChar(10), mealLog.site_code)
                .input('served_at', sql.DateTime2(0), new Date())
                .input('service_date', sql.Date, mealLog.service_date)
                .input('meal_type', sql.TinyInt, mealLog.meal_type)
                .input('identified_by', sql.TinyInt, mealLog.identified_by)
                .input('match_score', sql.Decimal(5, 4), null)
                .input('operator_user_id', sql.Int, mealLog.operator_user_id ?? null)
                .input('client_uuid', sql.UniqueIdentifier, mealLog.client_uuid)
                .input('synced_at', sql.DateTime2(0), null)
                .query(sqlInsertMealLog());

            const log = logResult.recordset[0] ?? null;

            // 3. Amarra os dois.
            if (log?.id) {
                await new sql.Request(transaction)
                    .input('id', sql.BigInt, couponRow.id)
                    .input('meal_log_id', sql.BigInt, log.id)
                    .query(sqlLinkCouponToMealLog());
            }

            await transaction.commit();

            return {
                coupon: {
                    id: Number(couponRow.id),
                    seq: Number(couponRow.seq),
                    meals_authorized: Number(couponRow.meals_authorized),
                    meals_remaining: Number(couponRow.meals_authorized) - Number(couponRow.seq),
                },
                log,
            };
        } catch (error) {
            await transaction.rollback().catch(() => { /* já abortada pelo XACT_ABORT */ });

            if (error instanceof AppError) throw error;

            /**
             * Corrida perdida — mas SÓ quando a constraint violada é a do saldo.
             *
             * `UX_meal_coupon_seq` pega o empate de sequência entre dois
             * terminais; `CK_meal_coupon_seq` pega a tentativa de passar do
             * saldo. Os dois significam a mesma coisa no balcão: 409, não 500,
             * porque o pedido estava certo e o cupom é que acabou.
             *
             * ⚠️ A checagem é pelo NOME da constraint, e não só pelo número do
             * erro. Custou uma sessão de depuração descobrir por quê: o mesmo
             * 547 sai de `CK_meal_log_diner` quando `meal_log` ainda não aceita
             * `diner_type = 3`, e o mesmo 2627 sai de `UX_meal_log_client`. Sem
             * o nome, um deploy com a migração de constraint faltando responde
             * "esse cupom acabou de ser usado em outro terminal" — com a tabela
             * de cupons vazia. Mentira perfeita: plausível, tranquilizadora e
             * apontando para o lugar errado.
             */
            const constraint = String(error?.message ?? '');
            const isCouponBalance = constraint.includes('UX_meal_coupon_seq')
                || constraint.includes('CK_meal_coupon_seq');

            if (isCouponBalance
                && (UNIQUE_VIOLATION_CODES.has(error?.number)
                    || error?.number === CONSTRAINT_VIOLATION_CODE)) {
                throw new AppError(
                    'Esse cupom acabou de ser usado em outro terminal.',
                    409,
                    { code: 'COUPON_EXHAUSTED' },
                );
            }

            /* Qualquer outra violação é defeito de configuração ou de código, e
               dizer isso é melhor que fingir que o cupom tem problema. O nome da
               constraint vai para o log, nunca para a resposta. */
            if (UNIQUE_VIOLATION_CODES.has(error?.number)
                || error?.number === CONSTRAINT_VIOLATION_CODE) {
                console.error('[meal-coupon.repository] constraint inesperada', constraint);
                throw new AppError(
                    'O registro da refeição foi recusado pelo banco. Avise o suporte.',
                    500,
                    { code: 'MEAL_COUPON_CONSTRAINT' },
                );
            }

            console.error('[meal-coupon.repository] redeem', error);
            throw new AppError('Não foi possível registrar a refeição do cupom.', 500, {
                code: 'MEAL_COUPON_DB_ERROR',
            });
        }
    }
}

module.exports = { MealCouponRepository };
