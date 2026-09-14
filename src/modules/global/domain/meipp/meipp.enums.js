/**
 * @fileoverview Espelho dos ENUMs do schema `meipp_*` (MySQL `global`).
 *
 * Todo valor aqui É o texto gravado na coluna — a validação de payload
 * (`schemas/meipp.schema.js`) usa estas listas para rejeitar enum inválido
 * ANTES de tocar no banco, que é o que evita o erro 1265 vir cru do MySQL.
 *
 * Mantidos num arquivo só porque são a mesma categoria de conhecimento ("os
 * ENUMs do schema") e mudam juntos quando o DDL muda — separá-los em doze
 * arquivos de três linhas não acrescentaria nada.
 *
 * @module modules/global/domain/meipp/meipp.enums
 */

/** `meipp_users.role` — matriz de permissão do painel. */
const MeippRole = Object.freeze({
    ADMIN:  'admin',
    EDITOR: 'editor',
    VIEWER: 'viewer',
});

/** `meipp_locations.type` */
const LocationType = Object.freeze({
    LOJA:            'loja',
    UNIDADE_INTERNA: 'unidade_interna',
    ESCRITORIO:      'escritorio',
    FABRICA:         'fabrica',
    OUTRO:           'outro',
});

/** `meipp_players.hardware_type` */
const HardwareType = Object.freeze({
    ANDROID_BOX:  'android_box',
    SMART_TV:     'smart_tv',
    RASPBERRY_PI: 'raspberry_pi',
    MINI_PC:      'mini_pc',
    OUTRO:        'outro',
});

/** `meipp_players.orientation` */
const Orientation = Object.freeze({
    LANDSCAPE: 'landscape',
    PORTRAIT:  'portrait',
});

/** `meipp_players.status` */
const PlayerStatus = Object.freeze({
    ONLINE:  'online',
    OFFLINE: 'offline',
    UNKNOWN: 'unknown',
});

/** `meipp_media.type` */
const MediaType = Object.freeze({
    IMAGE:  'image',
    VIDEO:  'video',
    HTML:   'html',
    WEBURL: 'weburl',
});

/** `meipp_media.status` */
const MediaStatus = Object.freeze({
    UPLOADING:  'uploading',
    PROCESSING: 'processing',
    READY:      'ready',
    ERROR:      'error',
});

/** `meipp_playlist_items.transition` */
const Transition = Object.freeze({
    NONE:  'none',
    FADE:  'fade',
    SLIDE: 'slide',
});

/** `meipp_schedule_targets.target_type` */
const TargetType = Object.freeze({
    PLAYER: 'player',
    GROUP:  'group',
    ALL:    'all',
});

/** `meipp_device_commands.command_type` */
const CommandType = Object.freeze({
    REBOOT:          'reboot',
    RELOAD_PLAYLIST: 'reload_playlist',
    CLEAR_CACHE:     'clear_cache',
    SCREENSHOT:      'screenshot',
});

/** `meipp_device_commands.status` */
const CommandStatus = Object.freeze({
    PENDING:      'pending',
    SENT:         'sent',
    ACKNOWLEDGED: 'acknowledged',
    FAILED:       'failed',
});

/** `meipp_player_status_log.event_type` */
const StatusLogEvent = Object.freeze({
    ONLINE:  'online',
    OFFLINE: 'offline',
    ERROR:   'error',
    REBOOT:  'reboot',
});

/** Helper para os schemas de validação: `values(MediaType)` → `['image', ...]`. */
const values = (frozenEnum) => Object.values(frozenEnum);

module.exports = {
    MeippRole,
    LocationType,
    HardwareType,
    Orientation,
    PlayerStatus,
    MediaType,
    MediaStatus,
    Transition,
    TargetType,
    CommandType,
    CommandStatus,
    StatusLogEvent,
    values,
};
