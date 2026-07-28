const { ProtheusUseCases } = require('../protheus.use-cases');
const { ProtheusRepositoryPort } = require('../ports/protheus-repository.port');

function makeFakeRepository(overrides = {}) {
    const repo = new ProtheusRepositoryPort();
    repo.findCostCenters = jest.fn().mockResolvedValue([{ costCenterCode: '1005' }]);
    repo.findBranches = jest.fn().mockResolvedValue([{ M0_CODFIL: '0203' }]);
    repo.findAllBranches = jest.fn().mockResolvedValue([{ M0_CODFIL: '0203' }]);
    repo.findCompanies = jest.fn().mockResolvedValue([{ company_code: '01' }]);
    return Object.assign(repo, overrides);
}

function makeUseCases({ repository } = {}) {
    return new ProtheusUseCases({ repository: repository ?? makeFakeRepository() });
}

describe('ProtheusUseCases', () => {
    it('getCostCenters should delegate with the given companyCode', async () => {
        const repository = makeFakeRepository();
        const useCases = makeUseCases({ repository });
        await useCases.getCostCenters('01');
        expect(repository.findCostCenters).toHaveBeenCalledWith('01');
    });

    it('getBranches should delegate with the given companyCode', async () => {
        const repository = makeFakeRepository();
        const useCases = makeUseCases({ repository });
        await useCases.getBranches('01');
        expect(repository.findBranches).toHaveBeenCalledWith('01');
    });

    it('getAllBranches should delegate to the repository', async () => {
        const repository = makeFakeRepository();
        const useCases = makeUseCases({ repository });
        const result = await useCases.getAllBranches();
        expect(repository.findAllBranches).toHaveBeenCalled();
        expect(result).toEqual([{ M0_CODFIL: '0203' }]);
    });

    it('getCompanies should delegate to the repository', async () => {
        const repository = makeFakeRepository();
        const useCases = makeUseCases({ repository });
        const result = await useCases.getCompanies();
        expect(repository.findCompanies).toHaveBeenCalled();
        expect(result).toEqual([{ company_code: '01' }]);
    });
});
