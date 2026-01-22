// modules/gpprh/repositories/jobRepository.js
const { SQL_FIELDS } = require('../schema/jobSchema');

function sqlInsertJob(data) {
  const entries = verifyEntries(data);
  const columns = entries.map(value=>value[0]).join(',');
  const placeholders = entries.map(() => '?').join(',');
  return `INSERT INTO jobs (${columns}) VALUES (${placeholders})`;
}

function sqlUpdateJob(data, whereField = 'id') {
  const entries = verifyEntries(data);
  const setClause = entries
    .map(([key]) => `${key} = '${data[key]}'`)
    .join(', ');
  const sql = `UPDATE jobs SET ${setClause} WHERE ${whereField} = ${data[whereField]}`;
  return sql;
}

function sqlSelectJob() {
  return "SELECT * FROM gpprh.jobs  ORDER BY created_at DESC;";
}

function sqlOriginStatus(jobId){
  return `SELECT status FROM jobs WHERE id = ${jobId};`
}

function buildInsertParams(job) {
  const entries = verifyEntries(job)
  return entries.map(([, value]) => value);
}

function verifyEntries(data) {
  const entries = Object.entries(data)
    .filter(([key, value]) =>
      SQL_FIELDS.includes(key) && value !== undefined
    );

  if (!entries.length) {
    throw new Error('No valid fields to update');
  }

  return entries;
}

module.exports = { sqlInsertJob, sqlSelectJob, buildInsertParams, sqlUpdateJob, sqlOriginStatus };