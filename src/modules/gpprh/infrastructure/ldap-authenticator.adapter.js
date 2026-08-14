/**
 * @fileoverview Adapter — implementa `LdapAuthenticatorPort` delegando pro
 * `LDAPAuthenticator` já existente em `infra/auth` (infraestrutura compartilhada,
 * fora do escopo desta migração).
 * @module modules/gpprh/infrastructure/ldap-authenticator.adapter
 */

const LDAPAuthenticator = require('../../../infra/auth/ldap-auth.service');
const { LdapAuthenticatorPort } = require('../application/ports/ldap-authenticator.port');

class LdapAuthenticatorAdapter extends LdapAuthenticatorPort {
    async authenticate(username, password) {
        return new LDAPAuthenticator(username, password).authenticateUser(username, password);
    }
}

module.exports = { LdapAuthenticatorAdapter };
