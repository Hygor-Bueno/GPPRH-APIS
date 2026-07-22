// Schemas de validação para rotas EPP (produtos, menus, pedidos, log-vendas, estoque)

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ─── Produtos ─────────────────────────────────────────────────────────────────

const postProductSchema = {
    id_product:     { type: 'string', required: true,  minLength: 1, maxLength: 50 },
    description:    { type: 'string', required: true,  minLength: 1, maxLength: 200 },
    price:          { type: 'number', required: true,  min: 0 },
    status_prod:    { type: 'number', required: true,  enum: [0, 1] },
    id_category_fk: { type: 'number', required: true,  min: 1 },
    measure:        { type: 'string', maxLength: 20 },
};

const putProductSchema = {
    description:    { type: 'string', minLength: 1, maxLength: 200 },
    price:          { type: 'number', min: 0 },
    status_prod:    { type: 'number', enum: [0, 1] },
    id_category_fk: { type: 'number', min: 1 },
    measure:        { type: 'string', maxLength: 20 },
};

const patchProductStatusSchema = {
    status_prod: { type: 'number', required: true, enum: [0, 1] },
};

// ─── Menus ────────────────────────────────────────────────────────────────────

const postMenuSchema = {
    description: { type: 'string', required: true, minLength: 1, maxLength: 200 },
    status:      { type: 'number', enum: [0, 1] },
};

const putMenuSchema = {
    description: { type: 'string', required: true, minLength: 1, maxLength: 200 },
    status:      { type: 'number', enum: [0, 1] },
};

// ─── Log-Menus ────────────────────────────────────────────────────────────────

const postLogMenuSchema = {
    epp_id_menu:     { type: 'number', required: true, min: 1 },
    epp_id_product:  { type: 'number', required: true, min: 1 },
    plu_menu:        { type: 'string', required: true, minLength: 1, maxLength: 50 },
    type_base:       { type: 'string', maxLength: 20 },
    status_log_menu: { type: 'number', enum: [0, 1] },
};

const putLogMenuSchema = {
    epp_id_menu:     { type: 'number', required: true, min: 1 },
    epp_id_product:  { type: 'number', required: true, min: 1 },
    plu_menu:        { type: 'string', required: true, minLength: 1, maxLength: 50 },
    type_base:       { type: 'string', maxLength: 20 },
    status_log_menu: { type: 'number', enum: [0, 1] },
};

// ─── Pedidos ──────────────────────────────────────────────────────────────────

const postOrderSchema = {
    name_client:    { type: 'string', required: true, minLength: 1, maxLength: 200 },
    date_order:     { type: 'string', required: true, pattern: DATE_PATTERN },
    delivery_date:  { type: 'string', required: true, pattern: DATE_PATTERN },
    delivery_hour:  { type: 'string', required: true, minLength: 1 },
    delivery_store: { type: 'string', required: true, minLength: 1 },
    total:          { type: 'number', required: true, min: 0 },
    fone:           { type: 'string', maxLength: 20 },
    email:          { type: 'string', maxLength: 200 },
    signal_value:   { type: 'number', min: 0 },
    description:    { type: 'string', maxLength: 500 },
    observation:    { type: 'string', maxLength: 1000 },
};

const postOrderBulkSchema = {
    name_client:    { type: 'string', required: true, minLength: 1, maxLength: 200 },
    date_order:     { type: 'string', required: true, pattern: DATE_PATTERN },
    delivery_date:  { type: 'string', required: true, pattern: DATE_PATTERN },
    delivery_hour:  { type: 'string', required: true, minLength: 1 },
    delivery_store: { type: 'string', required: true, minLength: 1 },
    total:          { type: 'number', required: true, min: 0 },
};

const putOrderSchema = {
    name_client:    { type: 'string', minLength: 1, maxLength: 200 },
    date_order:     { type: 'string', pattern: DATE_PATTERN },
    delivery_date:  { type: 'string', pattern: DATE_PATTERN },
    delivery_hour:  { type: 'string', minLength: 1 },
    delivery_store: { type: 'string', minLength: 1 },
    total:          { type: 'number', min: 0 },
    fone:           { type: 'string', maxLength: 20 },
    email:          { type: 'string', maxLength: 200 },
    observation:    { type: 'string', maxLength: 1000 },
};

const patchOrderStatusSchema = {
    delivered: { type: 'number', required: true, enum: [1, 2] },
};

// ─── Log-Vendas ───────────────────────────────────────────────────────────────

const postLogSaleSchema = {
    epp_id_order:   { type: 'number', required: true, min: 1 },
    epp_id_product: { type: 'number', required: true, min: 1 },
    quantity:       { type: 'number', required: true, min: 0.5 },
    price:          { type: 'number', required: true, min: 0 },
};

const putLogSaleSchema = {
    epp_id_order:   { type: 'number', required: true, min: 1 },
    epp_id_product: { type: 'number', required: true, min: 1 },
    quantity:       { type: 'number', required: true, min: 0.5 },
    price:          { type: 'number', required: true, min: 0 },
};

// ─── Estoque ──────────────────────────────────────────────────────────────────

const postStockSchema = {
    id_product_fk:  { type: 'number', required: true, min: 1 },
    stock_quantity: { type: 'number', required: true },
    measure:        { type: 'string', required: true, minLength: 1, maxLength: 20 },
};

const putStockSchema = {
    id_product_fk:  { type: 'number', min: 1 },
    stock_quantity: { type: 'number' },
    measure:        { type: 'string', maxLength: 20 },
};

const postEcommerceOrderSchema = {
    delivery_date:  { type: 'string', required: true, pattern: DATE_PATTERN },
    delivery_hour:  { type: 'string', required: true, minLength: 1 },
    delivery_store: { type: 'string', required: true, minLength: 1 },
};

module.exports = {
    postProductSchema,
    putProductSchema,
    patchProductStatusSchema,
    postMenuSchema,
    putMenuSchema,
    postLogMenuSchema,
    putLogMenuSchema,
    postOrderSchema,
    postOrderBulkSchema,
    putOrderSchema,
    patchOrderStatusSchema,
    postLogSaleSchema,
    putLogSaleSchema,
    postStockSchema,
    putStockSchema,
    postEcommerceOrderSchema,
};
