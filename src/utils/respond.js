/**
 * Helpers de resposta HTTP padronizados.
 *
 * Garante que toda resposta de sucesso siga o mesmo formato:
 *   { error: false, data? , message? }
 *
 * Uso:
 *   respond.ok(res, data)           → 200 { error: false, data }
 *   respond.created(res, data)      → 201 { error: false, data }
 *   respond.message(res, msg)       → 200 { error: false, message }
 *   respond.message(res, msg, 201)  → 201 { error: false, message }
 *   respond.accepted(res, data, msg) → 202 { error: false, data, message }  (aceito, ainda não aplicado)
 */
const respond = {
    ok: (res, data) =>
        res.status(200).json({ error: false, data }),

    created: (res, data) =>
        res.status(201).json({ error: false, data }),

    message: (res, message, statusCode = 200) =>
        res.status(statusCode).json({ error: false, message }),

    accepted: (res, data, message) =>
        res.status(202).json({ error: false, data, message })
};

module.exports = { respond };
