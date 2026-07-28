const { GpprhUserUseCases } = require('../gpprh-user.use-cases');
const { GpprhRepositoryPort } = require('../ports/gpprh-repository.port');

class FakeGpprhRepository extends GpprhRepositoryPort {}

describe('GpprhUserUseCases', () => {
    it('lists users by delegating to the repository with an empty identifier', async () => {
        const getUser = jest.fn().mockResolvedValue([{ user_id: 1 }, { user_id: 2 }]);
        const repository = new FakeGpprhRepository();
        repository.getUser = getUser;

        const useCases = new GpprhUserUseCases({ repository });
        const result = await useCases.listUsers();

        expect(getUser).toHaveBeenCalledWith('');
        expect(result).toEqual([{ user_id: 1 }, { user_id: 2 }]);
    });
});
