/**
 * @fileoverview Geração de senha temporária para reset pela gestão de acessos.
 *
 * Separado de `password.utils` de propósito: aquele módulo carrega `bcrypt`, um
 * addon nativo compilado para o Linux do container, que não abre em outros
 * ambientes. Como aqui só se usa `crypto`, a geração fica testável em qualquer
 * máquina — e gerar senha não tem nada a ver com calcular hash.
 *
 * @module modules/global/domain/auth/temporary-password
 */

const { randomInt } = require('crypto');

/**
 * Alfabeto da senha temporária — 51 caracteres.
 *
 * Fora `0/O/o`, `1/I/l`, `5/S/s` e `i`: a senha é ditada por telefone ou copiada
 * de um papel, e esses grupos produzem tentativa errada que parece senha
 * inválida. Com 51 símbolos e 12 posições, sobra entropia de folga
 * (51^12 ≈ 2^68) mesmo abrindo mão dos ambíguos.
 */
const TEMP_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZabcdefghjkmnpqrtuvwxyz2346789';

/** Comprimento da senha temporária. */
const TEMP_PASSWORD_LENGTH = 12;

/**
 * Gera uma senha temporária aleatória, distinta a cada reset.
 *
 * Deliberadamente aleatória por usuário, e não uma senha padrão compartilhada:
 * senha padrão vaza — fica em documentação, mensagem, boca a boca — e serve para
 * qualquer conta recém-resetada. Sendo aleatória, o vazamento de uma não
 * compromete as demais.
 *
 * Usa `crypto.randomInt`, criptograficamente seguro e sem viés de módulo.
 * `Math.random()` não serve para credencial.
 *
 * @returns {string}
 */
function generateTemporaryPassword() {
    let out = '';
    for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
        out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
    }
    return out;
}

module.exports = { generateTemporaryPassword, TEMP_PASSWORD_LENGTH, TEMP_ALPHABET };
