const ldap = require('ldapjs');
const adConfig = require('../../../config/ad');

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

  async bind(client, dn, password) {
    return new Promise((resolve, reject) => {
      client.bind(dn, password, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async authenticateUser() {
    /** ===============================
     *  CLIENT 1 — BUSCA DO USUÁRIO
     *  =============================== */
    const searchClient = this.createClient();

    searchClient.on('error', err => {
      console.error('LDAP search client error:', err);
    });

    await this.bind(searchClient, this.bindDN, this.password);

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
      throw new Error('Usuário não encontrado no AD');
    }

    /** ===============================
     *  CLIENT 2 — VALIDA CREDENCIAL
     *  =============================== */
    const authClient = this.createClient();

    authClient.on('error', err => {
      console.error('LDAP auth client error:', err);
    });

    try {
      await this.bind(authClient, user.dn, this.password);
    } catch (err) {
      throw new Error('Credenciais inválidas');
    } finally {
      authClient.unbind();
    }

    return {
      name: user.cn,
      guid: user.objectGUID,
      isActive: !(user.userAccountControl & 2)
    };
  }
}

module.exports = LDAPAuthenticator;
