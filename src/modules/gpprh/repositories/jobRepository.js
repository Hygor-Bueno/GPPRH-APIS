// modules/gpprh/repositories/jobRepository.js
const { SQL_FIELDS } = require('../schema/jobSchema');

function sqlInsertJob(data) {
  const entries = verifyEntries(data);
  const columns = entries.map(value => value[0]).join(',');
  const placeholders = entries.map(() => '?').join(',');
  return `INSERT INTO jobs (${columns}) VALUES (${placeholders})`;
}
function sqlInsertJobComments() {
  return `insert into gpprh.job_comments (job_id,candidate_id,comment) value (?,?,?);`;
}

function sqlUpdateJob(data, whereField = 'id') {
  const entries = verifyEntries(data);
  const setClause = entries
    .map(([key]) => `${key} = '${data[key]}'`)
    .join(', ');
  const sql = `UPDATE jobs SET ${setClause} WHERE ${whereField} = ${data[whereField]}`;
  return sql;
}

function sqlSelectJob(idCandidate = null) {
  const likedByMe = idCandidate
    ? `EXISTS (
         SELECT 1
         FROM gpprh.job_likes jl
         WHERE jl.job_id = jb.id
           AND jl.candidate_id = ${idCandidate}
       )`
    : `0`;
  const applicatedByMe = idCandidate
    ? `EXISTS (
         SELECT 1
         FROM gpprh.applications apc
         WHERE apc.job_id = jb.id
           AND apc.candidate_id = ${idCandidate}
       )`
    : `0`;
  return `
    SELECT
        jb.*,
        IFNULL(lk.likes, 0) AS likes,
        IFNULL(cms.comments, 0) AS comments,
        IFNULL(apc.applications, 0) AS applications,
        ${likedByMe} AS liked_by_me,
        ${applicatedByMe} AS applicated_by_me
    FROM gpprh.jobs jb
    LEFT JOIN (
        SELECT job_id, COUNT(*) AS likes
        FROM gpprh.job_likes
        GROUP BY job_id
    ) lk ON lk.job_id = jb.id
    LEFT JOIN (
        SELECT job_id, COUNT(*) AS comments
        FROM gpprh.job_comments
        GROUP BY job_id
    ) cms ON cms.job_id = jb.id
    LEFT JOIN (
        SELECT job_id, COUNT(*) AS applications
        FROM gpprh.applications
        GROUP BY job_id
    ) apc ON apc.job_id = jb.id
    WHERE jb.status = 'OPEN'
    ORDER BY jb.created_at DESC;
  `;
}

// recupera o status original do job antes de atualizar
function sqlOriginStatus(jobId) {
  return `SELECT status FROM jobs WHERE id = ${jobId};`
}

function sqlSelectJobComments() {
  return `SELECT cms.*,cd.name FROM gpprh.job_comments cms 
          INNER JOIN gpprh.candidates cd
          ON cms.candidate_id = cd.id
          WHERE job_id = ?
          ORDER BY cms.created_at;`;
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

function spToggleJobLike() {
  return "call sp_toggle_job_like(?, ?);";
}

function spToggleJobApplication() {
  return "call sp_toggle_job_application(?, ?);";
}

module.exports = { sqlInsertJob, sqlSelectJob, buildInsertParams, sqlUpdateJob, sqlOriginStatus, spToggleJobLike, spToggleJobApplication, sqlInsertJobComments, sqlSelectJobComments };