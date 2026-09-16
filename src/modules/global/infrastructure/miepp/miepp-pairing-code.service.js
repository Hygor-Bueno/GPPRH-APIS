/**
 * @fileoverview Emite e consome o código de pareamento de um player.
 *
 * ─── O código é curto e gravado, não assinado ────────────────────────────────
 * A primeira versão era um código assinado por HMAC, sem estado, para funcionar
 * no cluster de 2 instâncias sem tabela nova. Funcionava, mas tinha 62
 * caracteres: servia para copiar/colar ou QR, não para digitar numa tela com
 * controle remoto. Como o requisito passou a ser **8 dígitos**, não há entropia
 * para carregar assinatura — 8 dígitos só podem ser validados consultando onde
 * foram gravados. Daí `miepp_pairing_codes`.
 *
 * ─── O que segura um código de 8 dígitos ─────────────────────────────────────
 * 10^8 combinações é pouco para resistir a força bruta sozinho. O que protege
 * é a soma de quatro coisas:
 *
 *   1. **uso único** — `used_at` mata o código no primeiro pareamento;
 *   2. **validade curta** — 10 minutos por padrão;
 *   3. **um código vivo por player** — emitir outro apaga o anterior, então a
 *      quantidade de códigos válidos ao mesmo tempo é pequena;
 *   4. **`pairLimiter`** em `POST /device/pair` — poucas tentativas por IP por
 *      janela, que é o que torna a varredura inviável na prática.
 *
 * O ponto 4 é o essencial: sem ele os outros três não bastam. Se um dia a rota
 * de pareamento sair de trás do limiter, o tamanho do código precisa crescer.
 *
 * Ganho colateral em relação à versão assinada: agora o código **pode ser
 * cancelado** antes de expirar, porque existe uma linha para apagar.
 *
 * @module modules/global/infrastructure/miepp/miepp-pairing-code.service
 */

const crypto = require('crypto');

const { AppError } = require('../../../../errors/app.error');
const { execute, transaction } = require('./miepp-mysql.helper');
const {
    SQL_INVALIDATE_PLAYER_CODES,
    SQL_INSERT_PAIRING_CODE,
    SQL_FIND_PAIRING_CODE,
    SQL_CONSUME_PAIRING_CODE,
} = require('../../repositories/mysql/miepp-pairing-code.queries');

/** Validade padrão, em minutos — tempo de ir até a tela e concluir o pareamento. */
const DEFAULT_TTL_MINUTES = 10;

/** Dígitos do código. 8 é o teto pedido pelo requisito. */
const DEFAULT_CODE_LENGTH = 8;

/** Tentativas de gerar um código não colidente antes de desistir. */
const MAX_GENERATION_ATTEMPTS = 5;

class MieppPairingCodeService {
    /**
     * @param {object} options
     * @param {number} [options.ttlMinutes]
     * @param {number} [options.codeLength]
     */
    constructor({ ttlMinutes = DEFAULT_TTL_MINUTES, codeLength = DEFAULT_CODE_LENGTH } = {}) {
        this.ttlMs = ttlMinutes * 60 * 1000;
        this.codeLength = codeLength;
    }

    /**
     * @private
     * Sorteia um código só de dígitos.
     *
     * `randomInt` e não `Math.random()`: o gerador padrão do V8 é previsível a
     * partir de saídas observadas, e aqui o valor é um segredo de curta duração.
     *
     * Zeros à esquerda são preservados (`padStart`) — o código é texto, e
     * descartá-los reduziria o espaço de busca sem ninguém perceber.
     *
     * @returns {string}
     */
    _generateCode() {
        const ceiling = 10 ** this.codeLength;
        return String(crypto.randomInt(0, ceiling)).padStart(this.codeLength, '0');
    }

    /**
     * Emite um código para o player, invalidando os anteriores dele.
     *
     * @param {number} playerId
     * @param {number|null} [createdBy] - `_user.id` de quem pediu.
     * @returns {Promise<{code: string, expires_at: string, expires_in_seconds: number}>}
     */
    async issue(playerId, createdBy = null) {
        const expiresAt = new Date(Date.now() + this.ttlMs);

        // Apaga os códigos vivos deste player e, de quebra, o lixo expirado de
        // todos — é o que mantém a tabela pequena e a colisão improvável.
        await execute(SQL_INVALIDATE_PLAYER_CODES, [playerId]);

        for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
            const code = this._generateCode();

            try {
                await execute(SQL_INSERT_PAIRING_CODE, [playerId, code, expiresAt, createdBy]);

                return {
                    code,
                    expires_at: expiresAt.toISOString(),
                    expires_in_seconds: Math.round(this.ttlMs / 1000),
                };
            } catch (error) {
                // Colisão com um código ainda vivo de outro player: sorteia de
                // novo. Qualquer outro erro sobe.
                const duplicate = error?.details?.code === 'ER_DUP_ENTRY'
                    || error?.code === 'ER_DUP_ENTRY';
                if (!duplicate || attempt === MAX_GENERATION_ATTEMPTS) throw error;
            }
        }

        throw new AppError('Não foi possível gerar um código de pareamento. Tente novamente.', 500);
    }

    /**
     * Valida o código e o consome.
     *
     * Leitura e consumo vão na MESMA transação, com `FOR UPDATE` na busca: sem
     * isso, duas requisições simultâneas com o mesmo código passariam as duas e
     * o player receberia dois tokens.
     *
     * Toda falha (inexistente, expirado, já usado) vira o mesmo 401 — distinguir
     * ajudaria apenas quem está tentando adivinhar.
     *
     * @param {string} code
     * @returns {Promise<number>} `miepp_players.id`
     * @throws {AppError} 401
     */
    async verify(code) {
        const invalid = () => new AppError('Código de pareamento inválido ou expirado.', 401);

        if (typeof code !== 'string') throw invalid();

        const normalized = code.trim();
        if (!/^\d+$/.test(normalized) || normalized.length !== this.codeLength) throw invalid();

        return transaction(async (conn) => {
            const [rows] = await conn.query(SQL_FIND_PAIRING_CODE, [normalized]);
            if (rows.length === 0) throw invalid();

            const record = rows[0];
            const [result] = await conn.query(SQL_CONSUME_PAIRING_CODE, [record.id]);

            // Corrida perdida: outra transação consumiu entre o SELECT e o
            // UPDATE. Não deveria acontecer com o FOR UPDATE, mas se acontecer
            // o comportamento certo é recusar, não parear duas vezes.
            if (Number(result.affectedRows || 0) === 0) throw invalid();

            return Number(record.player_id);
        });
    }

    /**
     * Cancela os códigos vivos de um player, sem emitir outro.
     *
     * Só é possível porque agora existe linha para apagar — na versão assinada
     * não havia como revogar antes do vencimento.
     *
     * @param {number} playerId
     * @returns {Promise<number>} quantos foram invalidados.
     */
    async revoke(playerId) {
        const result = await execute(SQL_INVALIDATE_PLAYER_CODES, [playerId]);
        return Number(result.affectedRows || 0);
    }
}

module.exports = { MieppPairingCodeService, DEFAULT_TTL_MINUTES, DEFAULT_CODE_LENGTH };
