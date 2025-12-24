const poolGpprh = require('../../../config/mysql');
const { sqlInsertJob, sqlSelectJob } = require('../repositories/jobRepository');
const { Jobs } = require('../domain/Jobs');

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
        sqlInsertJob(),
        [
          job.company_name,
          job.position,
          job.description,
          job.salary_min,
          job.salary_max,
          job.location,
          job.created_by
        ]
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
      console.log(result);
      return result;
    } catch (error) {
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }
}
module.exports = { JobServices };
