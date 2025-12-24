// modules/gpprh/repositories/jobRepository.js
const { INSERT_FIELDS } = require('../schema/jobSchema');

function sqlInsertJob() {
  const columns = INSERT_FIELDS.join(',');
  const placeholders = INSERT_FIELDS.map(() => '?').join(',');
  return `INSERT INTO jobs (${columns}) VALUES (${placeholders})`;
}

function sqlSelectJob(){
  return "select * from jobs";
}

module.exports = { sqlInsertJob,sqlSelectJob };
