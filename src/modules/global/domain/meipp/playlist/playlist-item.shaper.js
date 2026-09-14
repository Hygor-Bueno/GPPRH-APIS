/**
 * @fileoverview Monta o item de playlist como o player Android o consome.
 *
 * Puro: recebe a linha já lida do banco (join de `meipp_playlist_items` com
 * `meipp_media`) e devolve o objeto do JSON. Quem assina a URL da mídia é o
 * caso de uso, que injeta a função `signUrl` — o domínio não conhece HMAC nem
 * variável de ambiente.
 *
 * @module modules/global/domain/meipp/playlist/playlist-item.shaper
 */

const { MediaStatus, MediaType } = require('../meipp.enums');

/** Usado quando nem o item nem a mídia trazem duração utilizável. */
const FALLBACK_DURATION_SECONDS = 10;

/**
 * Duração efetiva do item, em segundos.
 *
 * `duration_override` vence `meipp_media.duration_seconds` quando preenchido.
 * Zero é tratado como "não preenchido": a coluna é UNSIGNED e aceita 0, mas um
 * item de duração zero trava o carrossel do player num loop apertado.
 *
 * @param {{duration_override: number|null, duration_seconds: number|null}} row
 * @returns {number} sempre >= 1.
 */
function resolveDuration(row) {
    const override = Number(row.duration_override);
    if (Number.isFinite(override) && override > 0) return override;

    const base = Number(row.duration_seconds);
    if (Number.isFinite(base) && base > 0) return base;

    return FALLBACK_DURATION_SECONDS;
}

/**
 * Uma mídia só deve ser enviada ao player quando o arquivo está de fato
 * disponível. `weburl` é a exceção: não tem binário em `_files`, então não
 * passa por `uploading`/`processing` — o que vale é a URL cadastrada.
 *
 * @param {{status: string, type: string}} row
 * @returns {boolean}
 */
function isPlayable(row) {
    if (row.type === MediaType.WEBURL) return true;
    return row.status === MediaStatus.READY;
}

/**
 * Converte uma linha do join em item do JSON do device.
 *
 * @param {object}   row              - linha de `meipp_playlist_items` + `meipp_media`.
 * @param {Function} signUrl          - `(mediaUuid) => string`, injetada pelo caso de uso.
 * @returns {object} item pronto para o player.
 */
function shapeItem(row, signUrl) {
    return {
        item_id:    Number(row.item_id),
        order:      Number(row.order_index),
        transition: row.transition,
        duration:   resolveDuration(row),
        media: {
            uuid:      row.media_uuid,
            title:     row.title,
            type:      row.type,
            mime_type: row.mime_type,
            checksum:  row.checksum,
            size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
            // `weburl` aponta direto para fora; os demais tipos passam pela
            // rota de entrega assinada, que é o único caminho em que o player
            // (sem sessão de usuário) consegue baixar o binário.
            url: row.type === MediaType.WEBURL ? row.file_id : signUrl(row.media_uuid),
        },
    };
}

/**
 * Monta a lista completa de itens, descartando o que não está tocável.
 *
 * Descartar silenciosamente é deliberado: uma mídia ainda em `processing` no
 * meio de uma playlist não pode derrubar a reprodução inteira da tela. O painel
 * é quem mostra o status de cada mídia para quem edita.
 *
 * @param {object[]} rows
 * @param {Function} signUrl
 * @returns {object[]} ordenados por `order_index`.
 */
function shapeItems(rows = [], signUrl) {
    return rows
        .filter(isPlayable)
        .sort((left, right) => Number(left.order_index) - Number(right.order_index))
        .map((row) => shapeItem(row, signUrl));
}

module.exports = {
    FALLBACK_DURATION_SECONDS,
    resolveDuration,
    isPlayable,
    shapeItem,
    shapeItems,
};
