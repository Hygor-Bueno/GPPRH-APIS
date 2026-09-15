/**
 * @fileoverview Emite e valida o código de pareamento de um player.
 *
 * ─── Por que o código é assinado e não guardado ──────────────────────────────
 * O backend interno roda sob `pm2-runtime` em cluster com 2 instâncias (ver
 * `CLAUDE.md`). Um código guardado em memória só seria reconhecido pelo
 * processo que o emitiu — metade das tentativas de pareamento falharia, de
 * forma intermitente e praticamente indiagnosticável no balcão. Guardar no
 * banco exigiria uma tabela fora do schema fechado do módulo.
 *
 * Então o código é auto-contido: leva o player e o vencimento, assinados por
 * HMAC. Qualquer instância valida qualquer código.
 *
 * ─── O que isso custa ────────────────────────────────────────────────────────
 * Um código emitido **não pode ser cancelado** antes de expirar — não há onde
 * marcar a revogação. O TTL curto (10 min por padrão) é a única janela de
 * risco, e quem estiver com o código nesse intervalo consegue parear aquele
 * player específico. Se o requisito exigir revogação imediata ou um código
 * curto digitável no controle remoto (6 dígitos), aí sim é preciso uma tabela
 * `miepp_pairing_codes` — é a extensão natural daqui.
 *
 * @module modules/global/infrastructure/miepp/miepp-pairing-code.service
 */

const crypto = require('crypto');

const { AppError } = require('../../../../errors/app.error');

/** Validade padrão, em minutos — tempo de ir até a tela e concluir o pareamento. */
const DEFAULT_TTL_MINUTES = 10;

class MieppPairingCodeService {
    /**
     * @param {object} options
     * @param {string} options.secret - `MIEPP_PAIRING_SECRET`.
     * @param {number} [options.ttlMinutes]
     */
    constructor({ secret, ttlMinutes = DEFAULT_TTL_MINUTES } = {}) {
        this.secret = secret || '';
        this.ttlMs = ttlMinutes * 60 * 1000;
    }

    /**
     * @private
     * A checagem do segredo mora aqui, e não no construtor, pelo mesmo motivo
     * do `MieppMediaTokenService`: este processo serve outros módulos, e um
     * `.env` sem as chaves do miepp não pode derrubar o boot deles.
     */
    _sign(payload) {
        if (!this.secret) {
            throw new AppError('MIEPP_PAIRING_SECRET não configurado.', 500);
        }
        return crypto.createHmac('sha256', this.secret).update(payload).digest('hex');
    }

    /**
     * Emite o código para um player.
     *
     * A assinatura é truncada em 32 hex (128 bits): o suficiente para tornar a
     * falsificação inviável num código que vive 10 minutos, e curto o bastante
     * para o código caber na tela do painel e ser copiado sem quebra de linha.
     *
     * @param {number} playerId
     * @returns {{code: string, expires_at: string, expires_in_seconds: number}}
     */
    issue(playerId) {
        const expiresAt = Math.floor((Date.now() + this.ttlMs) / 1000);
        const signature = this._sign(`${playerId}.${expiresAt}`).slice(0, 32);

        const code = Buffer.from(`${playerId}.${expiresAt}.${signature}`, 'utf8')
            .toString('base64url');

        return {
            code,
            expires_at: new Date(expiresAt * 1000).toISOString(),
            expires_in_seconds: Math.round(this.ttlMs / 1000),
        };
    }

    /**
     * Valida o código e devolve o player a que ele pertence.
     *
     * Toda falha (formato, assinatura, vencimento) vira o mesmo 401: distinguir
     * "código malformado" de "código expirado" só ajudaria quem está tentando
     * adivinhar.
     *
     * @param {string} code
     * @returns {number} `miepp_players.id`
     * @throws {AppError} 401
     */
    verify(code) {
        const invalid = () => new AppError('Código de pareamento inválido ou expirado.', 401);

        if (typeof code !== 'string' || code.length === 0) throw invalid();

        let decoded;
        try {
            decoded = Buffer.from(code, 'base64url').toString('utf8');
        } catch {
            throw invalid();
        }

        const parts = decoded.split('.');
        if (parts.length !== 3) throw invalid();

        const [rawPlayerId, rawExpiresAt, signature] = parts;
        const playerId = Number(rawPlayerId);
        const expiresAt = Number(rawExpiresAt);

        if (!Number.isInteger(playerId) || playerId <= 0) throw invalid();
        if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) throw invalid();

        const expected = this._sign(`${playerId}.${expiresAt}`).slice(0, 32);

        const received = Buffer.from(signature, 'utf8');
        const computed = Buffer.from(expected, 'utf8');

        if (received.length !== computed.length) throw invalid();
        if (!crypto.timingSafeEqual(received, computed)) throw invalid();

        return playerId;
    }
}

module.exports = { MieppPairingCodeService, DEFAULT_TTL_MINUTES };
