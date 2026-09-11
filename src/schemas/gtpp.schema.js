// Schemas de validação para rotas GTPP (tarefas, itens, respostas, temas, score)

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Limites espelhados nas colunas reais do banco (schema `global`). Campos
 * LONGTEXT/TEXT ficam sem `maxLength` de propósito — um teto artificial aqui
 * rejeitava texto que a coluna aceita sem problema:
 *
 *   gt_task.description            VARCHAR(255)   → título da tarefa
 *   gt_task.full_description       LONGTEXT       → descrição da tarefa
 *   gt_task_historic.description   LONGTEXT       → justificativa da transição
 *   gt_task_item.description       VARCHAR(255)
 *   gt_task_item.note              VARCHAR(10000)
 *   gt_task_item_response.comment  VARCHAR(1000)
 *   gt_theme.description_theme     VARCHAR(125)
 */
const TITLE_MAX        = 255;
const ITEM_DESC_MAX    = 255;
const ITEM_NOTE_MAX    = 10000;
const ITEM_COMMENT_MAX = 1000;
const THEME_DESC_MAX   = 125;

// ─── Tarefas ──────────────────────────────────────────────────────────────────

/**
 * POST /gtpp/tasks — `title` é o título (gt_task.description) e `description`
 * é a descrição longa (gt_task.full_description), seguindo o mapeamento feito
 * no controller. O campo obrigatório é o título, não a descrição.
 */
const postTaskSchema = {
    title:        { type: 'string', required: true, minLength: 1, maxLength: TITLE_MAX },
    description:  { type: 'string' },
    priority:     { type: 'number', enum: [1, 2, 3] },
    initial_date: { type: 'string', pattern: DATE_PATTERN },
    final_date:   { type: 'string', pattern: DATE_PATTERN },
    expire_day:   { type: 'number', min: 0 },
    theme_id:     { type: 'number', min: 0 },
};

const putTaskStateSchema = {
    state_id:    { type: 'number', required: true, min: 1 },
    description: { type: 'string' },
    days:        { type: 'number', min: 0 },
};

const putTaskTitleSchema = {
    description: { type: 'string', required: true, minLength: 1, maxLength: TITLE_MAX },
};

const putTaskDescriptionSchema = {
    full_description: { type: 'string', minLength: 1 },
    description:      { type: 'string', minLength: 1 },
};

const putTaskThemeSchema = {
    theme_id: { type: 'number', min: 0 },
};

// ─── Itens ────────────────────────────────────────────────────────────────────

const postTaskItemSchema = {
    description: { type: 'string', required: true, minLength: 1, maxLength: ITEM_DESC_MAX },
    note:        { type: 'string', maxLength: ITEM_NOTE_MAX },
    final_date:  { type: 'string', pattern: DATE_PATTERN },
};

const putTaskItemSchema = {
    action: {
        type: 'string',
        required: true,
        enum: ['check', 'yes_no', 'description', 'file', 'note', 'assigned_to', 'status', 'position'],
    },
};

// ─── Respostas ────────────────────────────────────────────────────────────────

const putTaskItemResponseSchema = {
    comment: { type: 'string', maxLength: ITEM_COMMENT_MAX },
};

// ─── Usuários da tarefa ───────────────────────────────────────────────────────

const putTaskUserSchema = {
    user_id: { type: 'number', required: true, min: 1 },
};

// ─── Escopo ───────────────────────────────────────────────────────────────────

const postTaskScopeSchema = {
    company_code:     { type: 'string', maxLength: 10 },
    branch_code:      { type: 'string', maxLength: 10 },
    cost_center_code: { type: 'string', maxLength: 20 },
};

// ─── Mensagens ────────────────────────────────────────────────────────────────

const postTaskMessageSchema = {
    description: { type: 'string', maxLength: 1000 },
};

// ─── Temas ────────────────────────────────────────────────────────────────────

const postThemeSchema = {
    description_theme: { type: 'string', required: true, minLength: 1, maxLength: THEME_DESC_MAX },
};

const putThemeSchema = {
    description_theme: { type: 'string', minLength: 1, maxLength: THEME_DESC_MAX },
};

// ─── Score / Desqualificação ──────────────────────────────────────────────────

const disqualifyQuerySchema = {
    task_id:    { type: 'number', required: true, min: 1 },
    disqualify: { type: 'number', required: true, enum: [0, 1] },
};

module.exports = {
    postTaskSchema,
    putTaskStateSchema,
    putTaskTitleSchema,
    putTaskDescriptionSchema,
    putTaskThemeSchema,
    postTaskItemSchema,
    putTaskItemSchema,
    putTaskItemResponseSchema,
    putTaskUserSchema,
    postTaskScopeSchema,
    postTaskMessageSchema,
    postThemeSchema,
    putThemeSchema,
    disqualifyQuerySchema,
};
