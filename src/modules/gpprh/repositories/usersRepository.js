function sqlUsers() {
  return `call sp_get_user_authorization(?);`;
}

function spAdLoginUser() {
  return "call sp_ad_login_user(?, ?, ?);";
}

module.exports = {
  sqlUsers,
  spAdLoginUser
};