const { GtppScoreUseCases } = require('../gtpp-score.use-cases');
const { ScoreRepositoryPort } = require('../ports/score-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new ScoreRepositoryPort();
    repo.findScore = jest.fn().mockResolvedValue({ score: 5, user_task_count: 2, attached_task_count: 1, current_task_count: 1, finished_task_count: 1, disqualify_task_count: 0 });
    repo.findAllUsersWithAccess = jest.fn().mockResolvedValue([{ id: 1, user: 'Fulano' }, { id: 3, user: 'Admin' }]);
    repo.findDisqualify = jest.fn().mockResolvedValue({ disqualify: 0 });
    repo.updateDisqualify = jest.fn().mockResolvedValue({ updated: 1 });
    return Object.assign(repo, overrides);
}

describe('GtppScoreUseCases', () => {
    describe('getUserScore', () => {
        it('should return the empty score when the repository returns null', async () => {
            const repository = makeFakeRepository({ findScore: jest.fn().mockResolvedValue(null) });
            const useCases = new GtppScoreUseCases({ repository });
            const result = await useCases.getUserScore(1);
            expect(result.score).toBe(0);
        });
    });

    describe('getAllUsersScore', () => {
        it('should mask locked users and not call findScore for them', async () => {
            const repository = makeFakeRepository();
            const useCases = new GtppScoreUseCases({ repository });

            const result = await useCases.getAllUsersScore();

            const admin = result.find(r => r.id === 3);
            expect(admin.score).toBe('- 🔒 -');
            expect(repository.findScore).toHaveBeenCalledTimes(1); // só o usuário 1, não o 3
        });

        it('should fall back to empty score when findScore rejects', async () => {
            const repository = makeFakeRepository({ findScore: jest.fn().mockRejectedValue(new Error('boom')) });
            const useCases = new GtppScoreUseCases({ repository });

            const result = await useCases.getAllUsersScore();

            const fulano = result.find(r => r.id === 1);
            expect(fulano.score).toBe(0);
        });
    });

    describe('getTaskDisqualify', () => {
        it('should throw 404 when the task does not exist', async () => {
            const repository = makeFakeRepository({ findDisqualify: jest.fn().mockResolvedValue(null) });
            const useCases = new GtppScoreUseCases({ repository });
            await expect(useCases.getTaskDisqualify(999)).rejects.toThrow(AppError);
        });
    });

    describe('updateTaskDisqualify', () => {
        it('should throw 404 when nothing was updated', async () => {
            const repository = makeFakeRepository({ updateDisqualify: jest.fn().mockResolvedValue({ updated: 0 }) });
            const useCases = new GtppScoreUseCases({ repository });
            await expect(useCases.updateTaskDisqualify(999, 1)).rejects.toThrow(AppError);
        });
    });
});
