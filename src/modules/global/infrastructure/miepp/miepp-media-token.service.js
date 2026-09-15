/**
 * @fileoverview Assina e verifica as URLs de entrega de mídia.
 *
 * O player não tem sessão de usuário, então a rota que serve o binário não pode
 * depender do cookie. Em vez de abrir a rota, cada URL sai assinada por HMAC e
 * com validade curta, emitida no momento em que `GET /miepp/device/playlist`
 * monta a resposta.
 *
 * O token carrega o player: uma URL vazada só serve para o dispositivo a que
 * foi emitida, e some sozinha no vencimento.
 *
 * @module modules/global/infrastructure/miepp/miepp-media-token.service
 */

const crypto = require('crypto');

const { AppError } = require('../../../../errors/app.error');

/** Validade padrão, em horas. Cobre um dia de veiculação com folga. */
const DEFAULT_TTL_HOURS = 24;

class MieppMediaTokenService {
    /**
     * @param {object} options
     * @param {string} options.secret     - `MIEPP_MEDIA_TOKEN_SECRET`.
     * @param {string} [options.baseUrl]  - prefixo público das URLs de mídia.
     * @param {number} [options.ttlHours]
     */
    constructor({ secret, baseUrl = '', ttlHours = DEFAULT_TTL_HOURS } = {}) {
        this.secret = secret || '';
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.ttlMs = ttlHours * 60 * 60 * 1000;
    }

    /**
     * @private
     * Assinatura canônica de `<uuid>.<playerId>.<expira>`.
     *
     * A checagem do segredo mora aqui, e não no construtor, porque este
     * processo serve EPP, GTPP e GAPP na mesma instância: um `.env` sem as
     * chaves do miepp não pode impedir os outros módulos de subir. O erro
     * aparece na primeira rota do miepp que for usada, com o nome da variável.
     */
    _sign(payload) {
        if (!this.secret) {
            throw new AppError('MIEPP_MEDIA_TOKEN_SECRET não configurado.', 500);
        }
        return crypto.createHmac('sha256', this.secret).update(payload).digest('hex');
    }

    /**
     * Emite o token de uma mídia para um player.
     *
     * @param {string} mediaUuid - `miepp_media.uuid`.
     * @param {number} playerId
     * @returns {string} `<expiraEmSegundos>.<assinatura>`
     */
    issue(mediaUuid, playerId) {
        const expiresAt = Math.floor((Date.now() + this.ttlMs) / 1000);
        const signature = this._sign(`${mediaUuid}.${playerId}.${expiresAt}`);
        return `${expiresAt}.${signature}`;
    }

    /**
     * URL completa que vai no JSON da playlist.
     *
     * @param {string} mediaUuid
     * @param {number} playerId
     * @returns {string}
     */
    buildUrl(mediaUuid, playerId) {
        const token = this.issue(mediaUuid, playerId);
        return `${this.baseUrl}/miepp/media/${mediaUuid}/file?t=${token}&p=${playerId}`;
    }

    /**
     * Verifica o token recebido na rota de entrega.
     *
     * A comparação é `timingSafeEqual` — comparar hex com `===` vaza, pelo
     * tempo de resposta, quantos caracteres iniciais o atacante acertou.
     *
     * @param {string} mediaUuid
     * @param {string|number} playerId
     * @param {string} token
     * @returns {boolean}
     */
    verify(mediaUuid, playerId, token) {
        if (typeof token !== 'string') return false;

        const separator = token.indexOf('.');
        if (separator <= 0) return false;

        const expiresAt = Number(token.slice(0, separator));
        const signature = token.slice(separator + 1);

        if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;

        const expected = this._sign(`${mediaUuid}.${playerId}.${expiresAt}`);

        const received = Buffer.from(signature, 'hex');
        const computed = Buffer.from(expected, 'hex');

        if (received.length !== computed.length) return false;
        return crypto.timingSafeEqual(received, computed);
    }
}

module.exports = { MieppMediaTokenService, DEFAULT_TTL_HOURS };
