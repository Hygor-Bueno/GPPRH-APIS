/**
 * @fileoverview Consultas SQL puras para `miepp_pairing_codes`.
 *
 * ─── Por que o código passou a ser gravado ───────────────────────────────────
 * A primeira versão era um código assinado (HMAC) e sem estado, para funcionar
 * no cluster de 2 instâncias sem tabela nova. O custo era o tamanho: 62
 * caracteres, bom para copiar/colar ou QR, impossível de digitar num controle
 * remoto. Como o requisito passou a ser **8 dígitos**, não há entropia para
 * carregar assinatura — um código curto só pode ser validado consultando onde
 * ele foi gravado.
 *
 * O que sustenta a segurança agora, já que 8 dígitos são adivinháveis por força
 * bruta em tese:
 *   1. **uso único** — `used_at` mata o código no primeiro pareamento;
 *   2. **validade curta** — minutos, não horas;
 *   3. **um código vivo por player** — emitir outro invalida o anterior;
 *   4. **limite agressivo de tentativas** em `POST /device/pair`
 *      (`pairLimiter`, ver `rate-limit.middleware`).
 *
 * @module modules/global/repositories/mysql/miepp-pairing-code.queries
 */

/**
 * Invalida os códigos vivos de um player.
 *
 * Chamado antes de emitir um novo: dois códigos válidos ao mesmo tempo para a
 * mesma tela dobram a superfície de adivinhação sem servir a ninguém — quem
 * pediu um código novo é porque o anterior não serve mais.
 *
 * Também limpa o lixo: expirados de qualquer player saem junto, o que evita a
 * tabela crescer e reduz a chance de colisão no `code`.
 *
 * Parâmetros: `[player_id]`
 */
const SQL_INVALIDATE_PLAYER_CODES = `
    DELETE FROM miepp_pairing_codes
    WHERE player_id = ? OR expires_at <= NOW() OR used_at IS NOT NULL
`;

/**
 * Parâmetros: `[player_id, code, expires_at, created_by]`
 */
const SQL_INSERT_PAIRING_CODE = `
    INSERT INTO miepp_pairing_codes (player_id, code, expires_at, created_by)
    VALUES (?, ?, ?, ?)
`;

/**
 * Busca o código vivo. `FOR UPDATE` porque a leitura e a marcação de uso
 * acontecem na mesma transação — sem a trava, duas tentativas simultâneas com
 * o mesmo código gerariam dois tokens de device.
 *
 * Parâmetros: `[code]`
 */
const SQL_FIND_PAIRING_CODE = `
    SELECT id, player_id, expires_at
    FROM miepp_pairing_codes
    WHERE code = ? AND used_at IS NULL AND expires_at > NOW()
    LIMIT 1
    FOR UPDATE
`;

/** Parâmetros: `[id]` */
const SQL_CONSUME_PAIRING_CODE = `
    UPDATE miepp_pairing_codes SET used_at = NOW() WHERE id = ? AND used_at IS NULL
`;

module.exports = {
    SQL_INVALIDATE_PLAYER_CODES,
    SQL_INSERT_PAIRING_CODE,
    SQL_FIND_PAIRING_CODE,
    SQL_CONSUME_PAIRING_CODE,
};
