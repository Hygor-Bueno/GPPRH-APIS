/**
 * @fileoverview Schemas de validação das rotas do CPPP.
 *
 * Formato do `validate.middleware` da casa. Aqui fica só a forma de cada
 * campo; a combinação entre eles (que campo cada tipo de ajuste exige) é regra
 * de domínio — `domain/cppp/adjustment/adjustment.rules.js`.
 *
 * @module schemas/cppp.schema
 */

const { AdjustmentType, values } = require('../modules/global/domain/cppp/cppp.enums');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** `2026-08-20T17:10`, com segundos opcionais, `T` ou espaço. */
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;
/** CPF ou PIS, com ou sem máscara. */
const IDENTIFIER_PATTERN = /^[\d.\-\s]{11,14}$/;

const postCollectRunSchema = {
    device_id: { type: 'number', required: true, min: 1 },
};

// O IP (`base_url`) tem regra própria — só IP literal, só rede interna — em
// `domain/cppp/device/device.rules.js`; aqui só o tamanho.
const postDeviceSchema = {
    code:       { type: 'string',  required: true,  minLength: 2, maxLength: 20 },
    name:       { type: 'string',  required: true,  minLength: 2, maxLength: 100 },
    base_url:   { type: 'string',  required: true,  maxLength: 255 },
    rep_number: { type: 'string',  required: false, pattern: /^\d{17}$/ },
    active:     { type: 'boolean', required: false },
};

const putDeviceSchema = {
    name:       { type: 'string',  required: false, minLength: 2, maxLength: 100 },
    base_url:   { type: 'string',  required: false, maxLength: 255 },
    rep_number: { type: 'string',  required: false, pattern: /^\d{17}$/ },
    active:     { type: 'boolean', required: false },
};

const testConnectionSchema = {
    base_url: { type: 'string', required: true, maxLength: 255 },
};

const postAdjustmentSchema = {
    type:         { type: 'string', required: true, enum: values(AdjustmentType) },
    cpf:          { type: 'string', required: true, pattern: IDENTIFIER_PATTERN },
    reason:       { type: 'string', required: true, minLength: 3, maxLength: 500 },
    work_date:    { type: 'string', required: false, pattern: DATE_PATTERN },
    punch_at:     { type: 'string', required: false, pattern: DATETIME_PATTERN },
    device_id:    { type: 'number', required: false, min: 1 },
    nsr:          { type: 'number', required: false, min: 1 },
    starts_at:    { type: 'string', required: false, pattern: DATETIME_PATTERN },
    ends_at:      { type: 'string', required: false, pattern: DATETIME_PATTERN },
    period_start: { type: 'string', required: false, pattern: DATE_PATTERN },
    period_end:   { type: 'string', required: false, pattern: DATE_PATTERN },
};

const cancelAdjustmentSchema = {
    reason: { type: 'string', required: true, minLength: 3, maxLength: 500 },
};

module.exports = {
    postCollectRunSchema,
    postDeviceSchema,
    putDeviceSchema,
    testConnectionSchema,
    postAdjustmentSchema,
    cancelAdjustmentSchema,
};
