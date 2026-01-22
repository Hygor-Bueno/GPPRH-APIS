const ldap = require('ldapjs');
const adConfig = require('../../../config/ad');
const { UnauthorizedError } = require('../../../errors/UnauthorizedError');
const { AppError } = require('../../../errors/AppError');

class LDAPAuthenticator {
  constructor(username, password) {
    this.url = adConfig.url;
    this.domain = adConfig.domain;
    this.username = username;
    this.password = password;
    this.searchBase = adConfig.baseDN;
    this.bindDN = `${this.domain}\\${this.username}`;
  }

  createClient() {
    return ldap.createClient({
      url: this.url,
      timeout: 5000,
      connectTimeout: 5000,
      reconnect: false
    });
  }

  bind(client, dn, password) {
    return new Promise((resolve, reject) => {
      client.bind(dn, password, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async authenticateUser() {
    /**
     * ===============================
     * CLIENT 1 — SEARCH USER
     * ===============================
     */
    const searchClient = this.createClient();

    searchClient.on('error', err => {
      console.error('[LDAP][SEARCH]', err);
    });

    // 🔐 bind inicial (valida usuário/senha)
    try {
      await this.bind(searchClient, this.bindDN, this.password);
    } catch (err) {
      throw new UnauthorizedError('Invalid username or password');
    }

    const opts = {
      filter: `(sAMAccountName=${this.username})`,
      scope: 'sub',
      attributes: [
        'dn',
        'cn',
        'displayName',
        'mail',
        'memberOf',
        'objectGUID',
        'userAccountControl'
      ]
    };

    const user = await new Promise((resolve, reject) => {
      let found = null;

      searchClient.search(this.searchBase, opts, (err, res) => {
        if (err) return reject(err);

        res.on('searchEntry', entry => {
          const attributes = {};
          entry.pojo.attributes.forEach(attr => {
            attributes[attr.type.toLowerCase()] = attr.values;
          });

          found = {
            dn: entry.pojo.objectName,
            cn: attributes.cn?.[0],
            displayName: attributes.displayname?.[0],
            mail: attributes.mail?.[0],
            memberOf: attributes.memberof || [],
            objectGUID: attributes.objectguid
              ? Buffer.from(attributes.objectguid[0]).toString('hex')
              : null,
            userAccountControl: attributes.useraccountcontrol
              ? parseInt(attributes.useraccountcontrol[0], 10)
              : undefined
          };
        });

        res.on('error', err => reject(err));
        res.on('end', () => resolve(found));
      });
    });

    searchClient.unbind();

    if (!user) {
      throw new UnauthorizedError('User not found in Active Directory');
    }

    /**
     * ===============================
     * CLIENT 2 — VALIDATE PASSWORD
     * ===============================
     */
    const authClient = this.createClient();

    authClient.on('error', err => {
      console.error('[LDAP][AUTH]', err);
    });

    try {
      await this.bind(authClient, user.dn, this.password);
    } catch (err) {
      throw new UnauthorizedError('Invalid username or password');
    } finally {
      authClient.unbind();
    }

    /**
     * ===============================
     * ACCOUNT STATUS VALIDATION
     * ===============================
     */
    const isDisabled = user.userAccountControl & 2;

    if (isDisabled) {
      throw new AppError('User account is disabled', 403);
    }

    return {
      name: user.cn,
      guid: user.objectGUID,
      email: user.mail,
      isActive: !isDisabled
    };
  }
}

module.exports = LDAPAuthenticator;
