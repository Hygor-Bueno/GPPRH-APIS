/**
 * @fileoverview Adapter SQL Server do autocadastro facial.
 *
 * Estende `SqlServerMealRepository` para herdar `findDiner` — o convite precisa
 * resolver nome e situação de desligamento antes de ser emitido, e reimplementar
 * essa leitura criaria duas versões da mesma consulta com chance de divergir.
 *
 * @module modules/meal/infrastructure/sqlserver-meal-enroll.repository
 */

const { poolPromise, sql } = require('../../../config/sqlserver');
const { AppError } = require('../../../errors/app.error');
const { SqlServerMealRepository } = require('./sqlserver-meal.repository');
const {
    sqlInsertToken,
    sqlFindToken,
    sqlSpendAttempt,
    sqlBurnToken,
    sqlBurnOpenTokenFor,
    sqlUpsertBiometric,
    sqlConsumeToken,
    sqlFindBiometricForVerify,
    sqlFindIdentifyCandidates,
    sqlRevokeBiometric,
    sqlFindBiometricStatus,
} = require('../repositories/sqlserver/meal-enroll.queries');

const UNIQUE_VIOLATION = new Set([2601, 2627]);

function isUniqueViolation(error) {
    if (UNIQUE_VIOLATION.has(error?.number)) return true;
    const nested = [error?.originalError, ...(error?.precedingErrors || [])];
    return nested.some(e => UNIQUE_VIOLATION.has(e?.number ?? e?.info?.number));
}

class SqlServerMealEnrollRepository extends SqlServerMealRepository {
    /** @private Aplica a chave de três partes numa request. */
    _key(request, { companyCode, employeeId, branchCode }) {
        return request
            .input('company_code', sql.VarChar(10), companyCode)
            .input('employee_id', sql.VarChar(6), employeeId)
            .input('branch_code', sql.VarChar(10), branchCode);
    }

    // ─── Convite ────────────────────────────────────────────────────────────

    async insertToken({ jti, companyCode, employeeId, branchCode, expiresAt, issuedBy }) {
        return this._run(async () => {
            const pool = await poolPromise;
            const request = this._key(pool.request(), { companyCode, employeeId, branchCode })
                .input('jti', sql.UniqueIdentifier, jti)
                .input('expires_at', sql.DateTime2(0), expiresAt)
                .input('issued_by', sql.Int, issuedBy);

            try {
                const result = await request.query(sqlInsertToken());
                return result.recordset[0];
            } catch (error) {
                /* `UX_meal_enroll_token_open` é único filtrado: um convite vivo
                   por pessoa. A violação aqui não é falha técnica — é a regra
                   funcionando. Traduzir para um código que o caso de uso
                   reconheça é o que permite a ele responder "já existe convite
                   aberto" em vez de propagar erro de banco. */
                if (isUniqueViolation(error)) {
                    throw new AppError('Convite em aberto já existe.', 409, {
                        code: 'DUPLICATE_OPEN_TOKEN',
                        details: error,
                    });
                }
                throw error;
            }
        }, 'Não foi possível emitir o convite de cadastro facial.');
    }

    async findToken(jti) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('jti', sql.UniqueIdentifier, jti)
                .query(sqlFindToken());
            return result.recordset[0] ?? null;
        }, 'Não foi possível consultar o convite.');
    }

    /**
     * Gasta uma tentativa e devolve o total já gasto.
     *
     * `null` quando nada foi atualizado — o `WHERE` da query recusa token
     * consumido, queimado, ou que já bateu 3. Distinguir "gastou a terceira" de
     * "não pôde gastar" é o que permite ao caso de uso queimar o convite no
     * momento certo.
     *
     * @returns {Promise<?number>}
     */
    async spendAttempt(jti) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('jti', sql.UniqueIdentifier, jti)
                .query(sqlSpendAttempt());

            const row = result.recordset?.[0];
            return row ? Number(row.attempts) : null;
        }, 'Não foi possível registrar a tentativa.');
    }

    async burnToken(jti, reason) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('jti', sql.UniqueIdentifier, jti)
                .input('burned_reason', sql.VarChar(40), reason)
                .query(sqlBurnToken());
            return result.rowsAffected?.[0] ?? 0;
        }, 'Não foi possível invalidar o convite.');
    }

    async burnOpenTokenFor(key, reason) {
        return this._run(async () => {
            const pool = await poolPromise;
            const request = this._key(pool.request(), key)
                .input('burned_reason', sql.VarChar(40), reason);
            const result = await request.query(sqlBurnOpenTokenFor());
            return result.rowsAffected?.[0] ?? 0;
        }, 'Não foi possível invalidar o convite anterior.');
    }

    // ─── Cadastro ───────────────────────────────────────────────────────────

    /**
     * Grava o vetor e consome o convite — **as duas coisas, ou nenhuma**.
     *
     * A transação existe por causa de uma assimetria. Se o vetor entrar e o token
     * não for consumido, o link continua valendo e a pessoa pode recadastrar em
     * cima: chato, reversível, sem prejuízo. O inverso é o problema — token
     * consumido sem vetor gravado deixa a pessoa **sem cadastro e sem link**, ou
     * seja, sem caminho de volta a não ser suporte manual, uma por uma.
     *
     * A ordem dentro da transação também não é indiferente: o vetor primeiro. Se
     * o `MERGE` falhar por constraint — vetor de tamanho errado, consentimento
     * posterior ao cadastro — o token nem é tocado.
     */
    async completeEnrollment({
        companyCode, employeeId, branchCode, jti,
        embedding, modelTag, enrollVerifiedBy,
        consentAt, consentVersion, consentIp, enrolledAt,
    }) {
        return this._run(async () => {
            const pool = await poolPromise;
            const transaction = new sql.Transaction(pool);

            await transaction.begin();

            try {
                const upsert = new sql.Request(transaction);
                this._key(upsert, { companyCode, employeeId, branchCode })
                    .input('embedding', sql.VarBinary(2048), embedding)
                    .input('model_tag', sql.VarChar(40), modelTag)
                    .input('enrolled_at', sql.DateTime2(0), enrolledAt ?? consentAt)
                .input('enroll_verified_by', sql.TinyInt, enrollVerifiedBy)
                    .input('consent_at', sql.DateTime2(0), consentAt)
                    .input('consent_version', sql.VarChar(20), consentVersion)
                    .input('consent_ip', sql.VarChar(45), consentIp ?? null);

                await upsert.query(sqlUpsertBiometric());

                const consume = new sql.Request(transaction);
                const consumed = await consume
                    .input('jti', sql.UniqueIdentifier, jti)
                    .query(sqlConsumeToken());

                /* Zero linhas aqui significa que o convite foi consumido ou
                   queimado por outra requisição entre a checagem do caso de uso e
                   este ponto. Abortar é o certo: gravar o vetor de um link que já
                   não vale deixaria um cadastro sem convite correspondente, e a
                   seção [9.2] da validação existe justamente para caçar esse
                   descasamento. */
                if ((consumed.rowsAffected?.[0] ?? 0) === 0) {
                    await transaction.rollback();
                    throw new AppError('Este link já foi usado.', 410, {
                        code: 'INVITE_USED',
                    });
                }

                await transaction.commit();
                return { enrolled: true };
            } catch (error) {
                /* `_aborted` evita o "no transaction is begun" quando o rollback
                   acima já rodou — mssql marca a transação e um segundo rollback
                   estoura por cima do erro original, escondendo a causa. */
                if (!transaction._aborted && transaction._acquiredConnection) {
                    try { await transaction.rollback(); } catch { /* já desfeita */ }
                }
                throw error;
            }
        }, 'Não foi possível concluir o cadastro facial.');
    }

    /**
     * Grava o vetor sem convite — cadastro presencial, no aparelho do operador.
     *
     * Sem transação, ao contrário do `completeEnrollment`: aqui não há segundo
     * efeito para manter em par. Não existe token a consumir, então o `MERGE`
     * sozinho é atômico e a transação não protegeria nada.
     */
    async saveBiometric({
        companyCode, employeeId, branchCode,
        embedding, modelTag, enrollVerifiedBy,
        consentAt, consentVersion, consentIp, enrolledAt,
    }) {
        return this._run(async () => {
            const pool = await poolPromise;
            const request = this._key(pool.request(), { companyCode, employeeId, branchCode })
                .input('embedding', sql.VarBinary(2048), embedding)
                .input('model_tag', sql.VarChar(40), modelTag)
                .input('enrolled_at', sql.DateTime2(0), enrolledAt ?? consentAt)
                .input('enroll_verified_by', sql.TinyInt, enrollVerifiedBy)
                .input('consent_at', sql.DateTime2(0), consentAt)
                .input('consent_version', sql.VarChar(20), consentVersion)
                .input('consent_ip', sql.VarChar(45), consentIp ?? null);

            await request.query(sqlUpsertBiometric());
            return { saved: true };
        }, 'Não foi possível gravar o cadastro facial.');
    }

    // ─── Verificação e revogação ────────────────────────────────────────────

    async findBiometricForVerify(key) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await this._key(pool.request(), key)
                .query(sqlFindBiometricForVerify());
            return result.recordset[0] ?? null;
        }, 'Não foi possível consultar o cadastro facial.');
    }

    /**
     * Vetores candidatos de uma loja, para identificação 1:N.
     *
     * Filtra por `model_tag` na própria query: vetor de outro modelo não compara,
     * e deixar essa checagem para o código que percorre a lista significaria
     * calcular scores sem significado e possivelmente eleger um deles.
     */
    async findIdentifyCandidates(siteCode, modelTag) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('site_code', sql.VarChar(10), siteCode)
                .input('model_tag', sql.VarChar(40), modelTag)
                .query(sqlFindIdentifyCandidates());
            return result.recordset;
        }, 'Não foi possível carregar os rostos cadastrados desta loja.');
    }

    async revokeBiometric(key) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await this._key(pool.request(), key)
                /* Relogio da aplicacao, o mesmo que gravou enrolled_at. Ver o
                   comentario em sqlRevokeBiometric. */
                .input('revoked_at', sql.DateTime2(0), new Date())
                .query(sqlRevokeBiometric());
            return result.rowsAffected?.[0] ?? 0;
        }, 'Não foi possível revogar o cadastro facial.');
    }

    async findBiometricStatus(key) {
        return this._run(async () => {
            const pool = await poolPromise;
            const result = await this._key(pool.request(), key)
                .query(sqlFindBiometricStatus());
            return result.recordset[0] ?? null;
        }, 'Não foi possível consultar a situação do cadastro facial.');
    }
}

module.exports = { SqlServerMealEnrollRepository };
