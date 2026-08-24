const ldap = require('ldapjs');
const adConfig = require('../../config/ad');
const { UnauthorizedError } = require('../../errors/unauthorized.error');
const { AppError } = require('../../errors/app.error');

const OPERATION_TIMEOUT_MS = 5000;

/**
 * O `timeout`/`connectTimeout` do client ldapjs cobre a maioria dos casos,
 * mas não é uma garantia — uma conexão meio-aberta (ex.: firewall descartando
 * pacotes em silêncio) pode nunca emitir 'error' nem 'end', deixando a
 * promise de bind()/search() pendurada pra sempre e travando a requisição de
 * login. Esse wrapper força um teto de tempo independente do client.
 */
function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (onTimeout) onTimeout();
      const err = new Error(`LDAP: timeout de ${ms}ms aguardando resposta do Active Directory`);
      err.code = 'LDAP_TIMEOUT';
      reject(err);
    }, ms);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

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
      reconnect: {
        initialDelay: 100,
        maxDelay: 3000,
        failAfter: 5
      }
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
      searchClient.destroy(); // força limpeza
    });

    // 🔐 bind inicial (valida usuário/senha)
    try {
      await withTimeout(
        this.bind(searchClient, this.bindDN, this.password),
        OPERATION_TIMEOUT_MS,
        () => searchClient.destroy()
      );
    } catch (err) {
      if (err.code === 'LDAP_TIMEOUT') {
        throw new AppError('Active Directory indisponível ou muito lento para responder', 503, { code: 'AD_UNAVAILABLE' });
      }
      throw new UnauthorizedError('Usuário ou senha inválidos.');
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

    const searchPromise = new Promise((resolve, reject) => {
      let found = null;

      searchClient.search(this.searchBase, opts, (err, res) => {
        if (err) return reject(err);

        res.on('searchEntry', entry => {
          // entry.attributes → Attribute[] com .buffers (bytes brutos) e .values (UTF-8 decodificado)
          // entry.pojo.attributes → objetos com .values já decodificados como UTF-8 (corrompido para binários)
          const attributes = {};
          for (const attr of entry.attributes) {
            attributes[attr.type.toLowerCase()] = attr.values;
          }

          // objectGUID é binário puro (16 bytes). @ldapjs/attribute decodifica via UTF-8 por padrão,
          // corrompendo bytes inválidos em U+FFFD (0xEFBFBD). Usamos .buffers[0] para os bytes reais.
          const guidAttr = entry.attributes.find(a => a.type.toLowerCase() === 'objectguid');
          const rawGuidBuffer = guidAttr?.buffers?.[0];

          found = {
            dn: entry.pojo.objectName,
            cn: attributes.cn?.[0],
            displayName: attributes.displayname?.[0],
            mail: attributes.mail?.[0],
            memberOf: attributes.memberof || [],
            objectGUID: rawGuidBuffer ? rawGuidBuffer.toString('hex') : null,
            userAccountControl: attributes.useraccountcontrol
              ? parseInt(attributes.useraccountcontrol[0], 10)
              : undefined
          };
        });

        res.on('error', err => reject(err));
        res.on('end', () => {
          searchClient.unbind(err => {
            if (err) console.error('Unbind error:', err);
            resolve(found);
          });
        });
      });
    });

    let user;
    try {
      user = await withTimeout(searchPromise, OPERATION_TIMEOUT_MS, () => searchClient.destroy());
    } catch (err) {
      if (err.code === 'LDAP_TIMEOUT') {
        throw new AppError('Active Directory indisponível ou muito lento para responder', 503, { code: 'AD_UNAVAILABLE' });
      }
      throw err;
    }

    searchClient.unbind();

    if (!user) {
      throw new UnauthorizedError('Usuário não encontrado no Active Directory.');
    }

    // O primeiro bind (DOMAIN\username) já validou as credenciais.
    // O segundo bind com DN completo é redundante e falha com caracteres especiais no nome.

    /**
     * ===============================
     * ACCOUNT STATUS VALIDATION
     * ===============================
     */
    const isDisabled = user.userAccountControl & 2;

    if (isDisabled) {
      throw new AppError('Conta de usuário desativada.', 403);
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
