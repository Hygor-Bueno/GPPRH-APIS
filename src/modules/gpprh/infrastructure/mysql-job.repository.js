const { poolGpprh } = require('../../../config/mysql');
const { JobRepositoryPort } = require('../application/ports/job-repository.port');
const {
    sqlInsertJob, sqlSelectJob, buildInsertParams, sqlUpdateJob, buildUpdateParams,
    sqlOriginStatus, spToggleJobLike, spToggleJobApplication, sqlInsertJobComments,
    sqlSelectJobComments, sqlSelectJobApplication
} = require('../repositories/job.queries');

/**
 * @implements {JobRepositoryPort}
 */
class MysqlJobRepository extends JobRepositoryPort {
    async insert(job) {
        const conn = await poolGpprh.getConnection();
        try {
            const [result] = await conn.execute(sqlInsertJob(job), buildInsertParams(job));
            return result;
        } finally {
            conn.release();
        }
    }

    async findOriginalStatus(id) {
        const conn = await poolGpprh.getConnection();
        try {
            const [req] = await conn.execute(sqlOriginStatus(), [id]);
            return req[0]?.status;
        } finally {
            conn.release();
        }
    }

    async update(job) {
        const conn = await poolGpprh.getConnection();
        try {
            const [result] = await conn.execute(sqlUpdateJob(job), buildUpdateParams(job));
            return result;
        } finally {
            conn.release();
        }
    }

    async toggleLike(jobId, candidateId) {
        const conn = await poolGpprh.getConnection();
        try {
            const [req] = await conn.execute(spToggleJobLike(), [jobId, candidateId]);
            return req[0];
        } finally {
            conn.release();
        }
    }

    async insertComment(jobId, candidateId, comment) {
        const conn = await poolGpprh.getConnection();
        try {
            const [req] = await conn.execute(sqlInsertJobComments(), [jobId, candidateId, comment]);
            return req[0];
        } finally {
            conn.release();
        }
    }

    async findComments(jobId) {
        const conn = await poolGpprh.getConnection();
        try {
            const [req] = await conn.execute(sqlSelectJobComments(), [jobId]);
            return req;
        } finally {
            conn.release();
        }
    }

    async toggleApplication(jobId, candidateId) {
        const conn = await poolGpprh.getConnection();
        try {
            // Ordem original preservada: a SP espera (candidate_id, job_id), invertido em relação a toggleLike.
            const [req] = await conn.execute(spToggleJobApplication(), [candidateId, jobId]);
            return req[0];
        } finally {
            conn.release();
        }
    }

    async findApplications(candidateId) {
        const conn = await poolGpprh.getConnection();
        try {
            const [req] = await conn.execute(sqlSelectJobApplication(), [candidateId]);
            return req;
        } finally {
            conn.release();
        }
    }

    async findAll(candidateId) {
        const conn = await poolGpprh.getConnection();
        try {
            const { sql, params } = sqlSelectJob(candidateId);
            const [result] = await conn.execute(sql, params);
            return result;
        } finally {
            conn.release();
        }
    }
}

module.exports = { MysqlJobRepository };
