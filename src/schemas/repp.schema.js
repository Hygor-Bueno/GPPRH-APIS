/**
 * @fileoverview Schemas de validação das rotas da REPP (reserva de espaços).
 *
 * Formato do `validate.middleware` da casa — só a forma de cada campo. Data
 * que existe no calendário, fim depois do início, passado, conflito e códigos
 * no Protheus são regra de domínio/caso de uso
 * (`domain/repp/booking.rules.js`), não daqui.
 *
 * A query da agenda (`start`, `end`, `space_id`) é validada no caso de uso:
 * no Express 5 `req.query` é recalculado a cada leitura, e a coerção de tipo
 * que o `validate` faz no objeto se perderia.
 *
 * @module schemas/repp.schema
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** `09:30` (aceita `09:30:00`). */
const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

const postBookingSchema = {
    space_id:         { type: 'number', required: true,  min: 1 },
    booking_date:     { type: 'string', required: true,  pattern: DATE_PATTERN },
    start_time:       { type: 'string', required: true,  pattern: TIME_PATTERN },
    end_time:         { type: 'string', required: true,  pattern: TIME_PATTERN },
    title:            { type: 'string', required: true,  minLength: 1, maxLength: 150 },
    // Ausentes = os da sessão (nome do usuário logado; empresa, filial e
    // centro de custo do login).
    requester_name:   { type: 'string', required: false, maxLength: 150 },
    company_code:     { type: 'string', required: false, pattern: /^\d{2}$/ },
    branch_code:      { type: 'string', required: false, pattern: /^\d{4}$/ },
    cost_center_code: { type: 'string', required: false, maxLength: 20 },
};

/** Tudo opcional: campo ausente fica como está. */
const putBookingSchema = {
    space_id:         { type: 'number', required: false, min: 1 },
    booking_date:     { type: 'string', required: false, pattern: DATE_PATTERN },
    start_time:       { type: 'string', required: false, pattern: TIME_PATTERN },
    end_time:         { type: 'string', required: false, pattern: TIME_PATTERN },
    title:            { type: 'string', required: false, minLength: 1, maxLength: 150 },
    requester_name:   { type: 'string', required: false, minLength: 1, maxLength: 150 },
    company_code:     { type: 'string', required: false, pattern: /^\d{2}$/ },
    branch_code:      { type: 'string', required: false, pattern: /^\d{4}$/ },
    cost_center_code: { type: 'string', required: false, maxLength: 20 },
};

/** Cancelar e recusar: motivo opcional. */
const reasonSchema = {
    reason: { type: 'string', required: false, maxLength: 255 },
};

/** Liberar uma data de dia da semana bloqueado. */
const unblockDateSchema = {
    date: { type: 'string', required: true, pattern: DATE_PATTERN },
};

/** Tornar um usuário administrador do espaço. */
const spaceAdminSchema = {
    user_id: { type: 'number', required: true, min: 1 },
};

module.exports = { postBookingSchema, putBookingSchema, reasonSchema, unblockDateSchema, spaceAdminSchema };
