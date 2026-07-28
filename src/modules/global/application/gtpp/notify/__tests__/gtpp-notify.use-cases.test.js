const { GtppNotifyUseCases } = require('../gtpp-notify.use-cases');
const { NotifyRepositoryPort } = require('../ports/notify-repository.port');

function makeFakeRepository(overrides = {}) {
    const repo = new NotifyRepositoryPort();
    repo.getAndConsume = jest.fn().mockResolvedValue([]);
    repo.insertNotification = jest.fn().mockResolvedValue(undefined);
    return Object.assign(repo, overrides);
}

describe('GtppNotifyUseCases', () => {
    describe('getAndConsumeNotifications', () => {
        it('should delegate to the repository', async () => {
            const repository = makeFakeRepository();
            const useCases = new GtppNotifyUseCases({ repository });

            await useCases.getAndConsumeNotifications(1);

            expect(repository.getAndConsume).toHaveBeenCalledWith(1);
        });

        it('should parse the object field from JSON', async () => {
            const repository = makeFakeRepository({
                getAndConsume: jest.fn().mockResolvedValue([{ id: 1, object: '{"task_id":5}' }])
            });
            const useCases = new GtppNotifyUseCases({ repository });

            const [row] = await useCases.getAndConsumeNotifications(1);

            expect(row.object).toEqual({ task_id: 5 });
        });

        it('should keep the object field as-is when it is not valid JSON', async () => {
            const repository = makeFakeRepository({
                getAndConsume: jest.fn().mockResolvedValue([{ id: 1, object: 'not-json' }])
            });
            const useCases = new GtppNotifyUseCases({ repository });

            const [row] = await useCases.getAndConsumeNotifications(1);

            expect(row.object).toBe('not-json');
        });

        it('should leave non-string object fields untouched (already null)', async () => {
            const repository = makeFakeRepository({
                getAndConsume: jest.fn().mockResolvedValue([{ id: 1, object: null }])
            });
            const useCases = new GtppNotifyUseCases({ repository });

            const [row] = await useCases.getAndConsumeNotifications(1);

            expect(row.object).toBeNull();
        });
    });
});
