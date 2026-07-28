const { GpprhJobUseCases } = require('../gpprh-job.use-cases');
const { JobRepositoryPort } = require('../ports/job-repository.port');
const { JobStatus } = require('../../domain/jobs/job-status.enum');

class FakeJobRepository extends JobRepositoryPort {}

function buildUseCases(overrides = {}) {
    const repository = new FakeJobRepository();
    Object.assign(repository, overrides);
    return new GpprhJobUseCases({ repository });
}

describe('GpprhJobUseCases', () => {
    describe('create', () => {
        it('builds the domain entity and inserts it', async () => {
            const insert = jest.fn().mockResolvedValue({ insertId: 10 });
            const useCases = buildUseCases({ insert });

            const result = await useCases.create({ branch_name: 'Matriz', branch_cod: '01' }, 42);

            expect(insert).toHaveBeenCalled();
            const insertedJob = insert.mock.calls[0][0];
            expect(insertedJob.created_by).toBe(42);
            expect(insertedJob.status).toBe(JobStatus.DRAFT);
            expect(result).toEqual({ insertId: 10 });
        });

        it('wraps any failure as a 400 AppError, even a domain validation error', async () => {
            const useCases = buildUseCases({});
            await expect(useCases.create({ salary_min: 100, salary_max: 10 }, 1))
                .rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('update', () => {
        it('validates the transition against the original status before updating', async () => {
            const findOriginalStatus = jest.fn().mockResolvedValue(JobStatus.DRAFT);
            const update = jest.fn().mockResolvedValue({ affectedRows: 1 });
            const useCases = buildUseCases({ findOriginalStatus, update });

            const result = await useCases.update({ id: 7, status: JobStatus.OPEN });

            expect(findOriginalStatus).toHaveBeenCalledWith(7);
            expect(update).toHaveBeenCalled();
            expect(result).toEqual({ affectedRows: 1 });
        });

        it('skips the transition check when there is no original status', async () => {
            const findOriginalStatus = jest.fn().mockResolvedValue(undefined);
            const update = jest.fn().mockResolvedValue({ affectedRows: 1 });
            const useCases = buildUseCases({ findOriginalStatus, update });

            await useCases.update({ id: 7, status: JobStatus.DRAFT });

            expect(update).toHaveBeenCalled();
        });

        it('wraps an invalid transition as a 409 AppError', async () => {
            const findOriginalStatus = jest.fn().mockResolvedValue(JobStatus.CLOSED);
            const useCases = buildUseCases({ findOriginalStatus });

            await expect(useCases.update({ id: 7, status: JobStatus.OPEN }))
                .rejects.toMatchObject({ statusCode: 409 });
        });
    });

    describe('delegating CRUD-ish operations', () => {
        it('postLike delegates to the repository', async () => {
            const toggleLike = jest.fn().mockResolvedValue({ liked: true });
            const useCases = buildUseCases({ toggleLike });
            await expect(useCases.postLike(1, 2)).resolves.toEqual({ liked: true });
            expect(toggleLike).toHaveBeenCalledWith(1, 2);
        });

        it('findAll delegates to the repository and wraps failures as 500', async () => {
            const findAll = jest.fn().mockRejectedValue(new Error('db down'));
            const useCases = buildUseCases({ findAll });
            await expect(useCases.findAll(5)).rejects.toMatchObject({ statusCode: 500 });
        });
    });
});
