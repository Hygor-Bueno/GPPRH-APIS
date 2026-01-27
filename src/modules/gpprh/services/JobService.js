const poolGpprh = require('../../../config/mysql');
const { sqlInsertJob, sqlSelectJob, buildInsertParams, sqlUpdateJob, sqlOriginStatus, spToggleJobLike, spToggleJobApplication, sqlInsertJobComments, sqlSelectJobComments } = require('../repositories/jobRepository');
const { Jobs } = require('../domain/Jobs/Jobs');
const { JOB_STATUS_META } = require('../domain/Jobs/job-status.meta');
const { AppError } = require('../../../errors/AppError');

class JobServices {
  async create(jobData, created_by) {
    let conn;
    try {
      const job = new Jobs({
        ...jobData,
        created_by
      });

      conn = await poolGpprh.getConnection();
      const [result] = await conn.execute(
        sqlInsertJob(job),
        buildInsertParams(job)
      );

      return result;
    } catch (error) {
      throw new AppError(error.message, 400);
    } finally {
      if (conn) conn.release();
    }
  }

  async update(jobData) {
    let conn;
    try {
      const job = new Jobs(jobData);
      conn = await poolGpprh.getConnection();

      const [req] = await conn.execute(
        sqlOriginStatus(job.id)
      );

      const originalStatus = req[0]?.status;
      originalStatus && job.validateStatusJob(originalStatus);

      const [result] = await conn.execute(
        sqlUpdateJob(job)
      );

      return result;
    } catch (error) {
      throw new AppError(error.message, 409);
    } finally {
      if (conn) conn.release();
    }
  }

  async postLike(job_id, candidate_id) {
    let conn;
    try {
      conn = await poolGpprh.getConnection();
      const [req] = await conn.execute(
        spToggleJobLike(),
        [job_id, candidate_id]
      );
      return req[0];
    } catch (error) {
      throw new AppError(error.message, 409);
    } finally {
      if (conn) conn.release();
    }
  }
  
  async postComments(job_id, candidate_id, comment) {
    let conn;
    try {
      conn = await poolGpprh.getConnection();
      const [req] = await conn.execute(
        sqlInsertJobComments(),
        [job_id, candidate_id, comment]
      );
      return req[0];
    } catch (error) {
      throw new AppError(error.message, 409);
    } finally {
      if (conn) conn.release();
    }
  }

  async getAllComments(codeJob) {
    let conn;
    try {
      conn = await poolGpprh.getConnection();
      const [req] = await conn.execute(sqlSelectJobComments(), [codeJob]);
      return req;
    } catch (error) {
      throw new AppError(error.message, 409);
    } finally {
      if (conn) conn.release();
    }
  }

  async postJobApplication(job_id, candidate_id) {
    let conn;
    try {
      conn = await poolGpprh.getConnection();
      const [req] = await conn.execute(
        spToggleJobApplication(),
        [candidate_id, job_id]
      );
      return req[0];
    } catch (error) {
      throw new AppError(error.message, 409);
    } finally {
      if (conn) conn.release();
    }
  }

  async findAll(codeCandidate) {
    let conn;
    try {
      conn = await poolGpprh.getConnection();
      const [result] = await conn.execute(
        sqlSelectJob(codeCandidate)
      );
      return result;
    } catch (error) {
      throw new AppError(error.message, 500);
    } finally {
      if (conn) conn.release();
    }
  }

  async findStatusJob(status) {
    return !JOB_STATUS_META[status]?.isFinal;
  }
}

module.exports = { JobServices };

