require('dotenv').config();

module.exports = {
  url: process.env.AD_URL,           // ldap://10.10.10.244
  domain: process.env.AD_DOMAIN,     // PEGPESE01
  baseDN: process.env.AD_BASEDN,     // DC=PEGPESE01,DC=com
  username: process.env.AD_USERNAME, // Destinado ao usuário de consulta apenas 
  password: process.env.AD_PASSWORD,
};