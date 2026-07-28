/**
 * @fileoverview Verificação de senha local (bcrypt).
 *
 * Reescreve hashes no formato legado PHP (`$2y$`) para o formato nativo do
 * Node (`$2b$`) antes de comparar. Hashes já no formato nativo (`$2b$`, ou
 * outras variantes bcrypt como `$2a$`/`$2x$`) são comparados como estão.
 *
 * @module modules/global/domain/auth/password.utils
 */

const bcrypt = require('bcrypt');

/**
 * @param {string} plainPassword
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plainPassword, hash) {
    const compatibleHash = hash.startsWith('$2y$')
        ? hash.replace('$2y$', '$2b$')
        : hash;
    return bcrypt.compare(plainPassword, compatibleHash);
}

module.exports = { verifyPassword };
