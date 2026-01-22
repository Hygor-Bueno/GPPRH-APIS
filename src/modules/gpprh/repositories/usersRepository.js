function sqlUsers() {
  return `call sp_get_user_authorization(?);`;
}

function spAdLoginUser() {
  return "call sp_ad_login_user(?, ?, ?);";
}

function sqlCandidate() {
  return "select * from candidates where id = ?;";
}

function spCandidateLogin() {
  return "call sp_candidate_login(?, ?);";
}

module.exports = {
  sqlUsers,
  sqlCandidate,
  spAdLoginUser,
  spCandidateLogin
};