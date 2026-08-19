// Schemas de validação para rotas do refeitório (meal)
//
// Estes schemas validam apenas o ENVELOPE — presença, tipo e faixa dos campos.
// A regra de negócio (chave de 3 partes, convidante tudo-ou-nada, identified_by
// coerente com diner_type) vive em `modules/meal/domain/meal-log.rules.js`,
// porque depende da combinação entre campos e não de cada campo isolado.

// ─── Registro de refeição ─────────────────────────────────────────────────────

// site_code é o M0_CODFIL de 4 dígitos, nunca o nome da loja: existem duas
// filiais chamadas Interlagos (0104 Frugal e 0202 Peg Pese).
const SITE_CODE = /^[0-9]{4}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const postMealLogSchema = {
    diner_type:    { type: 'number', required: true, min: 1, max: 2 },
    meal_type:     { type: 'number', required: true, min: 1, max: 3 },
    identified_by: { type: 'number', required: true, min: 1, max: 4 },
    site_code:     { type: 'string', required: true, pattern: SITE_CODE },
    client_uuid:   { type: 'string', required: true, pattern: UUID },
};

// A fila offline manda um array em `logs`; cada item é validado item a item pelo
// domínio, no caso de uso. Validar aqui só o envelope evita rejeitar o lote
// inteiro por causa de um item — a sincronização precisa informar sucesso e
// falha por item, não abortar.
const postMealLogSyncSchema = {};

// ─── Baldes (grupos sem matrícula) ────────────────────────────────────────────

const postDinerGroupSchema = {
    label:      { type: 'string', required: true, minLength: 1, maxLength: 60 },
    sort_order: { type: 'number', required: false, min: 0, max: 32767 },
};

const patchDinerGroupSchema = {};

module.exports = {
    postMealLogSchema,
    postMealLogSyncSchema,
    postDinerGroupSchema,
    patchDinerGroupSchema,
};
