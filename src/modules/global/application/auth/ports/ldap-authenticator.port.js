/**
 * @fileoverview Porta (contrato) de autenticação via LDAP/Active Directory.
 * @module modules/global/application/auth/ports/ldap-authenticator.port
 */

class LdapAuthenticatorPort {
    /**
     * @param {string} username @param {string} password
     * @returns {Promise<{guid:string, name:string}>}
     * @throws quando as credenciais são inválidas ou o AD está indisponível
     */
    authenticate(username, password) { throw new Error('Not implemented'); }
}

module.exports = { LdapAuthenticatorPort };
