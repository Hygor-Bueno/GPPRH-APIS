/**
 * @fileoverview Monta o item de playlist como o player Android o consome.
 *
 * Puro: recebe a linha já lida do banco (join de `miepp_playlist_items` com
 * `miepp_media`) e devolve o objeto do JSON. Quem assina a URL da mídia é o
 * caso de uso, que injeta a função `signUrl` — o domínio não conhece HMAC nem
 * variável de ambiente.
 *
 * @module modules/global/domain/miepp/playlist/playlist-item.shaper
 */

const { MediaStatus, MediaType } = require('../miepp.enums');
// `origin` não é pergunta da playlist: a biblioteca de mídia do painel faz a
// mesma sobre a mesma linha. Reexportados no rodapé para não quebrar quem já
// os importava daqui.
const { MediaOrigin, resolveOrigin } = require('../media/media-origin.rules');

/** Usado quando nem o item nem a mídia trazem duração utilizável. */
const FALLBACK_DURATION_SECONDS = 10;

/** `item_id` da reserva injetada na lista. Não existe em `miepp_playlist_items`. */
const FALLBACK_ITEM_ID = 0;

/**
 * Duração efetiva do item, em segundos.
 *
 * `duration_override` vence `miepp_media.duration_seconds` quando preenchido.
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
 * Segundos que ainda restam de validade do CONTEÚDO, ou `null` quando ele não
 * vence.
 *
 * Quem calcula é o SQL (`ITEM_MAX_AGE_EXPRESSION`), porque o relógio de
 * referência é o do banco — o mesmo que carimbou `last_checked_at`. Aqui só
 * normalizamos: o mysql2 devolve a expressão como string em algumas versões, e
 * `null` precisa continuar `null` em vez de virar 0.
 *
 * @param {{max_age_seconds: number|string|null}} row
 * @returns {number|null}
 */
function resolveMaxAge(row) {
    if (row.max_age_seconds === null || row.max_age_seconds === undefined) return null;

    const seconds = Number(row.max_age_seconds);
    return Number.isFinite(seconds) ? Math.max(0, Math.trunc(seconds)) : null;
}

/**
 * O conteúdo deste item já venceu?
 *
 * Só dá `true` para item com prazo — mídia sem validade nunca vence, por mais
 * antiga que seja.
 *
 * @param {object} row
 * @returns {boolean}
 */
function isExpired(row) {
    return resolveMaxAge(row) === 0;
}

/**
 * Monta o objeto `media` do JSON.
 *
 * Extraído de `shapeItem` porque a mídia de reserva (`fallback.media`) usa o
 * mesmo formato — e um segundo formato sairia de sincronia na primeira mudança
 * do contrato.
 *
 * @param {object}   row
 * @param {Function} signUrl
 * @returns {object}
 */
function shapeMedia(row, signUrl) {
    return {
        uuid:      row.media_uuid,
        title:     row.title,
        type:      row.type,
        mime_type: row.mime_type,
        checksum:  row.checksum,
        size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
        origin:    resolveOrigin(row),
        // `weburl` aponta direto para fora; os demais tipos passam pela
        // rota de entrega assinada, que é o único caminho em que o player
        // (sem sessão de usuário) consegue baixar o binário.
        url: row.type === MediaType.WEBURL ? row.file_id : signUrl(row.media_uuid),
    };
}

/**
 * Converte uma linha do join em item do JSON do device.
 *
 * `max_age_seconds` só aparece quando existe: item sem prazo omite o campo em
 * vez de mandar `null`, porque no contrato acordado com o app "ausente" quer
 * dizer "não vence" — mandar `null` obrigaria o app a tratar os dois casos.
 *
 * @param {object}   row              - linha de `miepp_playlist_items` + `miepp_media`.
 * @param {Function} signUrl          - `(mediaUuid) => string`, injetada pelo caso de uso.
 * @returns {object} item pronto para o player.
 */
function shapeItem(row, signUrl) {
    const maxAge = resolveMaxAge(row);

    return {
        item_id:    Number(row.item_id),
        order:      Number(row.order_index),
        transition: row.transition,
        duration:   resolveDuration(row),
        ...(maxAge === null ? {} : { max_age_seconds: maxAge }),
        media: shapeMedia(row, signUrl),
    };
}

/**
 * A mídia de reserva como um item comum da lista.
 *
 * Existe para as telas que ainda não conhecem o campo `fallback`: uma APK
 * antiga que recebesse `items: []` apagaria a parede. Entregando a reserva
 * como item, ela toca em qualquer versão do app.
 *
 * Não leva `max_age_seconds`: a reserva é justamente o conteúdo perene, sem
 * preço, que não pode vencer nunca.
 *
 * @param {object}   row     - linha de `SQL_GET_DEVICE_MEDIA_BY_ID`.
 * @param {Function} signUrl
 * @returns {object}
 */
function shapeFallbackItem(row, signUrl) {
    return {
        item_id:    FALLBACK_ITEM_ID,
        order:      0,
        transition: 'none',
        duration:   resolveDuration(row),
        media:      shapeMedia(row, signUrl),
    };
}

/**
 * Monta a lista completa de itens, descartando o que não está tocável e o que
 * já venceu.
 *
 * Descartar o que não está tocável é silencioso e deliberado: uma mídia ainda
 * em `processing` no meio de uma playlist não pode derrubar a reprodução
 * inteira da tela. O painel é quem mostra o status de cada mídia para quem
 * edita.
 *
 * Descartar o que VENCEU tem uma condição a mais, e ela é regra de produto:
 * **só derrubamos o item vencido quando sobra alguma coisa para pôr no lugar.**
 * Preço vencido na parede é ruim; parede apagada é pior, e é o que aconteceria
 * numa playlist só de grades, todas vencidas, sem reserva configurada. Nesse
 * caso a lista volta como está e o item segue com `max_age_seconds: 0` — o app
 * recebe a informação de que o conteúdo venceu e decide, em vez de receber uma
 * tela preta pronta.
 *
 * O jeito de não cair nesse caso é configurar `MIEPP_FALLBACK_MEDIA_ID`.
 *
 * @param {object[]} rows
 * @param {Function} signUrl
 * @param {object}   [options]
 * @param {boolean}  [options.hasFallback=false] - existe reserva configurada e resolvida.
 * @returns {object[]} ordenados por `order_index`.
 */
function shapeItems(rows = [], signUrl, { hasFallback = false } = {}) {
    const playable = (rows || [])
        .filter(isPlayable)
        .sort((left, right) => Number(left.order_index) - Number(right.order_index));

    const fresh = playable.filter((row) => !isExpired(row));
    const chosen = (fresh.length > 0 || hasFallback) ? fresh : playable;

    return chosen.map((row) => shapeItem(row, signUrl));
}

module.exports = {
    FALLBACK_DURATION_SECONDS,
    FALLBACK_ITEM_ID,
    MediaOrigin,
    resolveDuration,
    resolveOrigin,
    resolveMaxAge,
    isPlayable,
    isExpired,
    shapeMedia,
    shapeItem,
    shapeFallbackItem,
    shapeItems,
};
