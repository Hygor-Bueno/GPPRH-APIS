/**
 * @fileoverview Schemas de validação das rotas do meipp.
 *
 * Formato do `validate.middleware` da casa (não é Zod nem Joi). O que importa
 * aqui é o `enum`: as colunas ENUM do schema recusam valor fora da lista com o
 * erro 1265 do MySQL, que chegaria ao cliente como 500 genérico. Validando
 * antes, o operador recebe 400 dizendo exatamente quais valores existem.
 *
 * As listas vêm de `domain/meipp/meipp.enums` — uma fonte só para o ENUM do
 * banco e a validação do payload, que é o que impede as duas de divergirem.
 *
 * @module schemas/meipp.schema
 */

const {
    MeippRole, LocationType, HardwareType, Orientation,
    MediaType, MediaStatus, Transition, TargetType, CommandType,
    CommandStatus, StatusLogEvent, values,
} = require('../modules/global/domain/meipp/meipp.enums');
const { ALL_DAYS } = require('../modules/global/domain/meipp/schedule/days-of-week');

/** `YYYY-MM-DD` */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** `HH:MM` ou `HH:MM:SS` */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
/** `1920x1080` */
const RESOLUTION_PATTERN = /^\d{3,5}x\d{3,5}$/;
/** MAC com dois-pontos ou hífen. */
const MAC_PATTERN = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
/** Só http/https — `weburl` vira `src` de WebView no player. */
const URL_PATTERN = /^https?:\/\/.+/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Locais ──────────────────────────────────────────────────────────────────

const postLocationSchema = {
    name:    { type: 'string',  required: true,  minLength: 1, maxLength: 150 },
    address: { type: 'string',  required: false, maxLength: 255 },
    type:    { type: 'string',  required: true,  enum: values(LocationType) },
    active:  { type: 'boolean', required: false },
};

const putLocationSchema = {
    name:    { type: 'string',  required: false, minLength: 1, maxLength: 150 },
    address: { type: 'string',  required: false, maxLength: 255 },
    type:    { type: 'string',  required: false, enum: values(LocationType) },
    active:  { type: 'boolean', required: false },
};

// ─── Usuários do painel ──────────────────────────────────────────────────────

const postUserSchema = {
    // Aponta para o usuário da sessão global — é o vínculo que evita um
    // cadastro de identidade paralelo (ver `meipp-user.queries`).
    global_user_id: { type: 'number',  required: true,  min: 1 },
    name:           { type: 'string',  required: true,  minLength: 1, maxLength: 150 },
    email:          { type: 'string',  required: true,  maxLength: 190, pattern: EMAIL_PATTERN },
    role:           { type: 'string',  required: true,  enum: values(MeippRole) },
    active:         { type: 'boolean', required: false },
};

const putUserSchema = {
    global_user_id: { type: 'number',  required: false, min: 1 },
    name:           { type: 'string',  required: false, minLength: 1, maxLength: 150 },
    email:          { type: 'string',  required: false, maxLength: 190, pattern: EMAIL_PATTERN },
    role:           { type: 'string',  required: false, enum: values(MeippRole) },
    active:         { type: 'boolean', required: false },
};

// ─── Players ─────────────────────────────────────────────────────────────────

const postPlayerSchema = {
    // `uuid` NÃO entra: é o identificador público da tela e o backend o gera.
    name:          { type: 'string',  required: true,  minLength: 1, maxLength: 150 },
    location_id:   { type: 'number',  required: false, min: 1 },
    hardware_type: { type: 'string',  required: true,  enum: values(HardwareType) },
    resolution:    { type: 'string',  required: false, maxLength: 20, pattern: RESOLUTION_PATTERN },
    orientation:   { type: 'string',  required: true,  enum: values(Orientation) },
    mac_address:   { type: 'string',  required: false, maxLength: 17, pattern: MAC_PATTERN },
    active:        { type: 'boolean', required: false },
};

const putPlayerSchema = {
    name:          { type: 'string',  required: false, minLength: 1, maxLength: 150 },
    location_id:   { type: 'number',  required: false, min: 1 },
    hardware_type: { type: 'string',  required: false, enum: values(HardwareType) },
    resolution:    { type: 'string',  required: false, maxLength: 20, pattern: RESOLUTION_PATTERN },
    orientation:   { type: 'string',  required: false, enum: values(Orientation) },
    mac_address:   { type: 'string',  required: false, maxLength: 17, pattern: MAC_PATTERN },
    active:        { type: 'boolean', required: false },
};

const postCommandSchema = {
    command_type: { type: 'string', required: true, enum: values(CommandType) },
    // `payload` é JSON livre: cada comando tem o seu formato e validá-lo aqui
    // engessaria a evolução do app do player. Vai serializado para a coluna
    // JSON, nunca concatenado em SQL.
};

// ─── Grupos ──────────────────────────────────────────────────────────────────

const postGroupSchema = {
    name:        { type: 'string', required: true,  minLength: 1, maxLength: 150 },
    description: { type: 'string', required: false, maxLength: 255 },
};

const putGroupSchema = {
    name:        { type: 'string', required: false, minLength: 1, maxLength: 150 },
    description: { type: 'string', required: false, maxLength: 255 },
};

const postGroupMemberSchema = {
    player_id: { type: 'number', required: true, min: 1 },
};

// ─── Mídia ───────────────────────────────────────────────────────────────────

/**
 * O upload é multipart, então os campos chegam como texto — daí a coerção de
 * `duration_seconds` feita pelo próprio `validate.middleware`.
 */
const postMediaSchema = {
    title:            { type: 'string', required: true,  minLength: 1, maxLength: 150 },
    type:             { type: 'string', required: true,  enum: values(MediaType) },
    // Obrigatório apenas quando `type = 'weburl'`; a regra condicional mora no
    // caso de uso, porque este validador não expressa dependência entre campos.
    // 500 = tamanho de `meipp_media.file_id`, que é onde a URL externa fica
    // gravada (ver `meipp-deploy.sql`).
    url:              { type: 'string', required: false, maxLength: 500, pattern: URL_PATTERN },
    duration_seconds: { type: 'number', required: false, min: 1, max: 86400 },
};

const putMediaSchema = {
    title:            { type: 'string', required: false, minLength: 1, maxLength: 150 },
    duration_seconds: { type: 'number', required: false, min: 1, max: 86400 },
    status:           { type: 'string', required: false, enum: values(MediaStatus) },
};

// ─── Playlists ───────────────────────────────────────────────────────────────

const postPlaylistSchema = {
    name:        { type: 'string',  required: true,  minLength: 1, maxLength: 150 },
    description: { type: 'string',  required: false, maxLength: 255 },
    active:      { type: 'boolean', required: false },
};

const putPlaylistSchema = {
    name:        { type: 'string',  required: false, minLength: 1, maxLength: 150 },
    description: { type: 'string',  required: false, maxLength: 255 },
    active:      { type: 'boolean', required: false },
};

const postPlaylistItemSchema = {
    media_id:          { type: 'number', required: true,  min: 1 },
    duration_override: { type: 'number', required: false, min: 1, max: 86400 },
    transition:        { type: 'string', required: false, enum: values(Transition) },
};

const putPlaylistItemSchema = {
    duration_override: { type: 'number', required: false, min: 1, max: 86400 },
    transition:        { type: 'string', required: false, enum: values(Transition) },
};

// ─── Agendamentos ────────────────────────────────────────────────────────────

const postScheduleSchema = {
    name:         { type: 'string',  required: true,  minLength: 1, maxLength: 150 },
    playlist_id:  { type: 'number',  required: true,  min: 1 },
    priority:     { type: 'number',  required: false },
    start_date:   { type: 'string',  required: false, pattern: DATE_PATTERN },
    end_date:     { type: 'string',  required: false, pattern: DATE_PATTERN },
    start_time:   { type: 'string',  required: false, pattern: TIME_PATTERN },
    end_time:     { type: 'string',  required: false, pattern: TIME_PATTERN },
    // Bitmask bit0=domingo … bit6=sábado. 0 desliga o agendamento na prática,
    // e é aceito: o `active` continua sendo a chave de liga/desliga explícita.
    days_of_week: { type: 'number',  required: false, min: 0, max: ALL_DAYS },
    active:       { type: 'boolean', required: false },
};

const putScheduleSchema = {
    name:         { type: 'string',  required: false, minLength: 1, maxLength: 150 },
    playlist_id:  { type: 'number',  required: false, min: 1 },
    priority:     { type: 'number',  required: false },
    start_date:   { type: 'string',  required: false, pattern: DATE_PATTERN },
    end_date:     { type: 'string',  required: false, pattern: DATE_PATTERN },
    start_time:   { type: 'string',  required: false, pattern: TIME_PATTERN },
    end_time:     { type: 'string',  required: false, pattern: TIME_PATTERN },
    days_of_week: { type: 'number',  required: false, min: 0, max: ALL_DAYS },
    active:       { type: 'boolean', required: false },
};

const postScheduleTargetSchema = {
    target_type: { type: 'string', required: true,  enum: values(TargetType) },
    // Obrigatório para `player`/`group` e proibido para `all` — dependência
    // entre campos, resolvida no caso de uso.
    target_id:   { type: 'number', required: false, min: 1 },
};

// ─── Device ──────────────────────────────────────────────────────────────────

const postPairSchema = {
    pairing_code: { type: 'string', required: true, minLength: 8, maxLength: 200 },
};

const postHeartbeatSchema = {
    app_version:     { type: 'string', required: false, maxLength: 30 },
    memory_used_mb:  { type: 'number', required: false, min: 0 },
    memory_total_mb: { type: 'number', required: false, min: 0 },
    storage_free_mb: { type: 'number', required: false, min: 0 },
    event_type:      { type: 'string', required: false, enum: values(StatusLogEvent) },
    message:         { type: 'string', required: false, maxLength: 500 },
    // O IP NÃO vem do corpo: é lido de `req.ip`. Um dispositivo não deve poder
    // declarar de onde está falando.
};

const postCommandAckSchema = {
    status: {
        type: 'string',
        required: true,
        // Só os dois estados finais que o device pode declarar — `pending` e
        // `sent` são do servidor.
        enum: [CommandStatus.ACKNOWLEDGED, CommandStatus.FAILED],
    },
};

module.exports = {
    postLocationSchema,
    putLocationSchema,
    postUserSchema,
    putUserSchema,
    postPlayerSchema,
    putPlayerSchema,
    postCommandSchema,
    postGroupSchema,
    putGroupSchema,
    postGroupMemberSchema,
    postMediaSchema,
    putMediaSchema,
    postPlaylistSchema,
    putPlaylistSchema,
    postPlaylistItemSchema,
    putPlaylistItemSchema,
    postScheduleSchema,
    putScheduleSchema,
    postScheduleTargetSchema,
    postPairSchema,
    postHeartbeatSchema,
    postCommandAckSchema,
    // Exportados para teste.
    DATE_PATTERN,
    TIME_PATTERN,
    RESOLUTION_PATTERN,
    MAC_PATTERN,
    URL_PATTERN,
};
