// modules/gpprh/repositories/jobRepository.js
const { SQL_FIELDS } = require('../schema/jobSchema');

function sqlInsertJob(data) {
  const entries = verifyEntries(data);
  const columns = entries.map(value => value[0]).join(',');
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

function sqlSelectJob(idCandidate = null) {
  const likedByMe = idCandidate
    ? `EXISTS (
         SELECT 1
         FROM gpprh.job_likes jl
         WHERE jl.job_id = jb.id
           AND jl.candidate_id = ${idCandidate}
       )`
    : `0`;
  return `
    SELECT
        jb.*,
        IFNULL(lk.likes, 0) AS likes,
        IFNULL(cms.comments, 0) AS comments,
        ${likedByMe} AS liked_by_me
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
    WHERE jb.status = 'OPEN'
    ORDER BY jb.created_at DESC;
  `;
}


function sqlOriginStatus(jobId) {
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

function spToggleJobLike() {
  return "call sp_toggle_job_like(?, ?);";
}

module.exports = { sqlInsertJob, sqlSelectJob, buildInsertParams, sqlUpdateJob, sqlOriginStatus, spToggleJobLike };