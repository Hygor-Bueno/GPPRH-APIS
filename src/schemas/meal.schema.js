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

// ─── Cupom fiscal (prestador de serviço) ──────────────────────────────────────

// `diner_type` continua limitado a 1 e 2 no `postMealLogSchema` acima, e isso é
// proposital: refeição de cupom NÃO passa por `/logs`. Ela tem rota própria
// porque precisa de transação (debitar o saldo e gravar a refeição são
// indivisíveis) e porque não pode entrar na fila de `/logs/sync` — a fila é
// exatamente onde o mesmo cupom passaria duas vezes. O limite ali é o que torna
// isso estrutural em vez de convenção.

// O QR chega como URL completa da SEFAZ, como o valor de `p`, ou como a chave
// nua de 44 dígitos. Aqui valida-se só a presença: o formato é problema do
// domínio, em `nfce-key.js`, que tem a tabela de posições e o dígito verificador.
const postCouponValidateSchema = {
    qr:        { type: 'string', required: true, minLength: 1, maxLength: 512 },
    site_code: { type: 'string', required: true, pattern: SITE_CODE },
};

const postCouponRedeemSchema = {
    qr:          { type: 'string', required: true, minLength: 1, maxLength: 512 },
    site_code:   { type: 'string', required: true, pattern: SITE_CODE },
    client_uuid: { type: 'string', required: true, pattern: UUID },
    meal_type:   { type: 'number', required: false, min: 1, max: 3 },
};

module.exports = {
    postMealLogSchema,
    postMealLogSyncSchema,
    postDinerGroupSchema,
    patchDinerGroupSchema,
    postCouponValidateSchema,
    postCouponRedeemSchema,
};
