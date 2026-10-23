const ldap = require('ldapjs');
const adConfig = require('../../config/ad');

class LDAPUserService {
    constructor() {
        this.url = adConfig.url;
        this.domain = adConfig.domain;
        this.username = adConfig.username;
        this.password = adConfig.password;
        this.searchBase = adConfig.baseDN;
        this.bindDN = `${this.domain}\\${this.username}`;
    }

    listActiveDirectoryUsers() {
        return new Promise((resolve, reject) => {
            const client = ldap.createClient({ url: this.url });

            client.on('error', (err) => {
                client.destroy();
                reject(err);
            });

            client.bind(this.bindDN, this.password, (err) => {
                if (err) {
                    client.destroy();
                    return reject(new Error('Falha no Bind do AD: ' + err.message));
                }

                const opts = {
                    filter: '(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))',
                    scope: 'sub',
                    attributes: ['dn', 'cn', 'samaccountname', 'mail', 'displayname', 'objectguid', 'useraccountcontrol'],
                    paged: true
                };


                const users = [];

                client.search(this.searchBase, opts, (err, res) => {
                    if (err) {
                        client.destroy();
                        return reject(err);
                    }

                    res.on('searchEntry', (entry) => {
                        const data = entry.pojo;
                        const mapUser = {
                            name: data.attributes.find(a => a.type.toLowerCase() === 'displayname')?.values[0] || null,
                            guid: entry.attributes.find(a => a.type.toLowerCase() === 'objectguid')?.buffers?.[0].toString('hex') || null,
                            status: data.attributes.find(a => a.type.toLowerCase() === 'useraccountcontrol')?.values[0] || null,
                            login: data.attributes.find(a => a.type.toLowerCase() === 'samaccountname')?.values[0] || null,
                            mail: data.attributes.find(a => a.type === 'mail')?.values[0] || null,
                            dn: data.objectName,
                        };
                        users.push(mapUser);
                    });

                    res.on('error', (searchErr) => {
                        client.destroy();
                        reject(searchErr);
                    });

                    res.on('end', (result) => {
                        client.unbind();
                        resolve(users);
                    });
                });
            });
        });
    }
}

module.exports = LDAPUserService;
