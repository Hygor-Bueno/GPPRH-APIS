// Schemas de validação para rotas GTPP (tarefas, itens, respostas, temas, score)

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ─── Tarefas ──────────────────────────────────────────────────────────────────

const postTaskSchema = {
    description:  { type: 'string', required: true, minLength: 1, maxLength: 500 },
    priority:     { type: 'number', enum: [1, 2, 3] },
    initial_date: { type: 'string', pattern: DATE_PATTERN },
    final_date:   { type: 'string', pattern: DATE_PATTERN },
};

const putTaskStateSchema = {
    state_id:    { type: 'number', required: true, min: 1 },
    description: { type: 'string', maxLength: 500 },
    days:        { type: 'number', min: 0 },
};

const putTaskTitleSchema = {
    description: { type: 'string', required: true, minLength: 1, maxLength: 500 },
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
    description: { type: 'string', required: true, minLength: 1, maxLength: 500 },
    note:        { type: 'string', maxLength: 500 },
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
    comment: { type: 'string', maxLength: 1000 },
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
    description_theme: { type: 'string', required: true, minLength: 1, maxLength: 200 },
};

const putThemeSchema = {
    description_theme: { type: 'string', minLength: 1, maxLength: 200 },
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
