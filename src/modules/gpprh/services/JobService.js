const poolGpprh = require('../../../config/mysql');
const { sqlInsertJob, sqlSelectJob, buildInsertParams, sqlUpdateJob, sqlOriginStatus } = require('../repositories/jobRepository');
const { Jobs } = require('../domain/Jobs/Jobs');
const { JOB_STATUS_META } = require('../domain/Jobs/job-status.meta');

class JobServices {
  async create(jobData, created_by) {
    let conn;
    try {
      // 🔹 domínio valida invariantes (Zod)
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
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }
  async update(jobData) {
    let conn;
    try {
      // 🔹 domínio valida invariantes (Zod)
      const job = new Jobs(jobData);
      conn = await poolGpprh.getConnection(); 
      
      //consulta qual o status original da tarefa antes de alterá-lo.
      const [req] = await conn.execute(
        sqlOriginStatus(job.id)
      );
      const originalStatus = req[0].status;

      originalStatus && job.validateStatusJob(originalStatus);
      const [result] = await conn.execute(
        sqlUpdateJob(job)
      );
      return result;
    } catch (error) {
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }

  async findAll() {
    let conn;
    try {
      conn = await poolGpprh.getConnection();
      const [result] = await conn.execute(sqlSelectJob());
      return result;
    } catch (error) {
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }

  async findStatusJob(status) {
    return !JOB_STATUS_META[status]?.isFinal;
  }
}
module.exports = { JobServices };
