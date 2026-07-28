const { AppError } = require('../../../errors/app.error');
const { JobService } = require('../domain/jobs/job.entity');

/**
 * @fileoverview Orquestração de vagas (jobs) do gpprh.
 *
 * Preserva o comportamento original: qualquer erro dentro de cada operação
 * (inclusive erros de validação de domínio do `JobService`) é reembrulhado
 * num `AppError` genérico com um status fixo por método — isso descarta o
 * status/code/details originais quando o erro já era um `AppError` (ex.:
 * validação de salário, que seria 422, vira 400/409 aqui). É um comportamento
 * pré-existente, preservado tal como estava, não corrigido.
 *
 * @module modules/gpprh/application/gpprh-job.use-cases
 */
class GpprhJobUseCases {
    /**
     * @param {{ repository: import('./ports/job-repository.port').JobRepositoryPort }} deps
     */
    constructor({ repository }) {
        this.repository = repository;
    }

    async create(jobData, createdBy) {
        try {
            const job = new JobService({ ...jobData, created_by: createdBy });
            return await this.repository.insert(job);
        } catch (error) {
            throw new AppError(error.message, 400);
        }
    }

    async update(jobData) {
        try {
            const job = new JobService(jobData);
            const originalStatus = await this.repository.findOriginalStatus(job.id);
            if (originalStatus) job.validateStatusJob(originalStatus);
            return await this.repository.update(job);
        } catch (error) {
            throw new AppError(error.message, 409);
        }
    }

    async postLike(jobId, candidateId) {
        try {
            return await this.repository.toggleLike(jobId, candidateId);
        } catch (error) {
            throw new AppError(error.message, 409);
        }
    }

    async postComments(jobId, candidateId, comment) {
        try {
            return await this.repository.insertComment(jobId, candidateId, comment);
        } catch (error) {
            throw new AppError(error.message, 409);
        }
    }

    async getAllComments(codeJob) {
        try {
            return await this.repository.findComments(codeJob);
        } catch (error) {
            throw new AppError(error.message, 409);
        }
    }

    async postJobApplication(jobId, candidateId) {
        try {
            return await this.repository.toggleApplication(jobId, candidateId);
        } catch (error) {
            throw new AppError(error.message, 409);
        }
    }

    async getJobApplication(candidateId) {
        try {
            return await this.repository.findApplications(candidateId);
        } catch (error) {
            throw new AppError(error.message, 409);
        }
    }

    async findAll(codeCandidate) {
        try {
            return await this.repository.findAll(codeCandidate);
        } catch (error) {
            throw new AppError(error.message, 500);
        }
    }
}

module.exports = { GpprhJobUseCases };
