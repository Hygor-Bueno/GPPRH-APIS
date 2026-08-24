/**
 * @fileoverview Porta de verificação de token de identidade do Google.
 * @module modules/gpprh/application/ports/google-token-verifier.port
 */

class GoogleTokenVerifierPort {
    /**
     * @param {string} credential
     * @returns {Promise<{email: string, name: string}>}
     */
    async verify(credential) { throw new Error('Not implemented'); }
}

module.exports = { GoogleTokenVerifierPort };
