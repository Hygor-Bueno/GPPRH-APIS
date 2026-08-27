/**
 * @fileoverview Porta de acesso a dados de vagas (jobs) do gpprh.
 * @module modules/gpprh/application/ports/job-repository.port
 */

class JobRepositoryPort {
    /** @param {import('../../domain/jobs/job.entity').JobService} job */
    async insert(job) { throw new Error('Not implemented'); }

    /** @param {number} id */
    async findOriginalStatus(id) { throw new Error('Not implemented'); }

    /** @param {import('../../domain/jobs/job.entity').JobService} job */
    async update(job) { throw new Error('Not implemented'); }

    /**
     * @param {number} jobId
     * @param {number} candidateId
     */
    async toggleLike(jobId, candidateId) { throw new Error('Not implemented'); }

    /**
     * @param {number} jobId
     * @param {number} candidateId
     * @param {string} comment
     */
    async insertComment(jobId, candidateId, comment) { throw new Error('Not implemented'); }

    /** @param {number} jobId */
    async findComments(jobId) { throw new Error('Not implemented'); }

    /**
     * @param {number} jobId
     * @param {number} candidateId
     */
    async toggleApplication(jobId, candidateId) { throw new Error('Not implemented'); }

    /** @param {number} candidateId */
    async findApplications(candidateId) { throw new Error('Not implemented'); }

    /** @param {number|null} candidateId */
    async findAll(candidateId) { throw new Error('Not implemented'); }
}

module.exports = { JobRepositoryPort };
