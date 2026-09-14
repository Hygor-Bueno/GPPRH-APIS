/**
 * @fileoverview Trilha de auditoria automática das escritas administrativas.
 *
 * O requisito pede que toda rota administrativa de escrita grave uma linha em
 * `meipp_audit_log`, centralizado — e não repetido em cada controller. É isto:
 * a rota declara `audit('player')` e o resto é automático.
 *
 * ─── Como captura o resultado ────────────────────────────────────────────────
 * Substitui `res.json` para observar o corpo da resposta. É o único ponto que
 * conhece, ao mesmo tempo, o autor (`req.meippUser`), o que foi pedido
 * (`req.method`, `req.params`) e o que saiu (o `data.id` do recurso criado) —
 * um middleware "antes" não teria o id de um POST, e um "depois" não existe no
 * Express sem interceptar a resposta.
 *
 * ─── Por que só grava em 2xx ─────────────────────────────────────────────────
 * Uma tentativa recusada por validação ou permissão não alterou nada; registrá-
 * la encheria a trilha de ruído e faria a auditoria deixar de responder "o que
 * mudou no sistema", que é a pergunta que ela existe para responder.
 *
 * @module middlewares/meipp-audit.middleware
 */

const { MysqlMeippAuditRepository } = require('../modules/global/infrastructure/meipp/mysql-meipp-audit.repository');

const repository = new MysqlMeippAuditRepository();

/** Verbo HTTP → ação registrada. */
const ACTION_BY_METHOD = Object.freeze({
    POST: 'create',
    PUT: 'update',
    PATCH: 'update',
    DELETE: 'delete',
});

/**
 * Campos que nunca entram no `detail`, mesmo que apareçam no corpo.
 *
 * `token` e `code` são os que importam: o corpo do pareamento e o da resposta
 * de token passam por aqui, e a trilha é lida por qualquer admin — gravar o
 * segredo ali anularia o cuidado de guardar só o hash em `meipp_device_tokens`.
 */
const REDACTED_KEYS = new Set(['token', 'code', 'password', 'password_hash', 'secret']);

/**
 * Copia o corpo sem os campos sensíveis e sem aninhar demais.
 *
 * @param {object} body
 * @returns {object|null}
 */
function sanitizeBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

    const clean = {};
    for (const [key, value] of Object.entries(body)) {
        if (REDACTED_KEYS.has(key)) continue;
        // Valores escalares bastam para a trilha; objetos grandes (payload de
        // comando, listas de reordenação) entram resumidos pelo `typeof`.
        clean[key] = (value !== null && typeof value === 'object')
            ? `[${Array.isArray(value) ? 'array' : 'object'}]`
            : value;
    }

    return Object.keys(clean).length > 0 ? clean : null;
}

/**
 * Descobre o id da entidade afetada.
 *
 * Em POST o id nasce na resposta; em PUT/DELETE ele já está na URL. A ordem
 * reflete isso: o corpo da resposta tem precedência por ser o recurso de fato
 * tocado.
 *
 * @param {object} req
 * @param {*} responseBody
 * @returns {number|null}
 */
function resolveEntityId(req, responseBody) {
    const fromResponse = responseBody?.data?.id;
    if (Number.isFinite(Number(fromResponse))) return Number(fromResponse);

    const fromParams = req.params?.id;
    if (Number.isFinite(Number(fromParams))) return Number(fromParams);

    return null;
}

/**
 * Middleware de auditoria para uma rota de escrita.
 *
 * @param {string} entityType - `player`, `playlist`, `schedule`…
 * @param {object} [options]
 * @param {string} [options.action] - sobrescreve a ação inferida do verbo
 *                                    (ex.: `'revoke_token'` num POST).
 * @returns {import('express').RequestHandler}
 */
function audit(entityType, { action } = {}) {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);

        res.json = (body) => {
            // Envia primeiro: a gravação da trilha não pode atrasar a resposta
            // nem, se falhar, transformar uma escrita bem-sucedida em erro.
            const result = originalJson(body);

            if (res.statusCode >= 200 && res.statusCode < 300) {
                repository.record({
                    userId: req.meippUser?.id ?? null,
                    action: action || ACTION_BY_METHOD[req.method] || req.method.toLowerCase(),
                    entityType,
                    entityId: resolveEntityId(req, body),
                    detail: sanitizeBody(req.body),
                }).catch((error) => {
                    console.error(
                        `[meipp] falha ao gravar auditoria (${entityType}):`,
                        error.message
                    );
                });
            }

            return result;
        };

        return next();
    };
}

module.exports = { audit, sanitizeBody, resolveEntityId, REDACTED_KEYS };
