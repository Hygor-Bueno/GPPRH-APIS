
/**
 * Hygor Bueno
 *
 * @class User
 * @typedef {User}
 */
const bcrypt = require("bcrypt");
class User {
  constructor(
    {
      id = null,
      user = '',
      password = "ACCESS_BY_AD",
      status = 1,
      administrator = 0,
      ad_guid = null,
      ad_status = "pending",
      name = '',
      registration = '',
      branch_code = '',
      table_protheus = null,
      created_at = null,
      created_by = 68,
      updated_at = null,
      updated_by = 68,
      application_ids = '',
      company_name = '',
      branch_name = '',
      cost_center_description = '',
     }
  ) {
    this.id = id;
    this.setUsername(user);
    this.password = password;
    this.status = status;
    this.administrator = administrator;
    this.ad_guid = ad_guid;
    this.ad_status = ad_status;
    this.setName(name);
    this.registration = registration?.trim();
    this.branch_code = branch_code?.trim();
    this.table_protheus = table_protheus;
    this.created_at = created_at;
    this.created_by = created_by;
    this.updated_at = updated_at;
    this.updated_by = updated_by;
    this.application_ids = application_ids;
    this.company_name = company_name?.trim();
    this.branch_name = branch_name?.trim();
    this.cost_center_description = cost_center_description?.trim();
  }

  isActive() {
    return this.status === 1;
  }

  isAdministrator() {
    return this.administrator === 1;
  }

  activate() {
    this.status = 1;
  }

  deactivate() {
    this.status = 0;
  }
  setUsername(username) {
    let resultado = username.replace(/\./g, "_");
    this.user = resultado.trim();
  }
  setName(name) {
    if (typeof name === "string" && name.trim() !== '') {
      let newName = name.trim();
      newName = this.capitalizeWords(newName);
      this.name = newName;
      this.nickname = this.nicknameFromName(newName);
    }
  }
  async setPassword(password) {
    const saltRounds = 10; // custo padrão do bcrypt
    const hash = await bcrypt.hash(password, saltRounds);
    this.password = hash;
  }
  capitalizeWords(sentence) {
    return sentence
      ? sentence.trim().split(/\s+/).map(word => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(' ')
      : sentence;
  }
  nicknameFromName(name) {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
  }

  setAdStatus(status) {
    const allowed = ['pending', 'active', 'blocked', 'delete'];
    if (!allowed.includes(status)) {
      throw new Error("Invalid AD status");
    }
    this.ad_status = status;
  }
}

module.exports = { User };