/**
 * @fileoverview Porta de autenticação via Active Directory (LDAP).
 * @module modules/gpprh/application/ports/ldap-authenticator.port
 */

class LdapAuthenticatorPort {
    /**
     * @param {string} username
     * @param {string} password
     * @returns {Promise<{name: string, guid: string, email: string, isActive: boolean}>}
     */
    async authenticate(username, password) { throw new Error('Not implemented'); }
}

module.exports = { LdapAuthenticatorPort };
