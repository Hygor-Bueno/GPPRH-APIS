const { GappLookupUseCases } = require('../gapp-lookup.use-cases');
const { LookupRepositoryPort } = require('../ports/lookup-repository.port');

const METHODS = [
    'listUnits', 'listActiveClass', 'listWorkGroup', 'listDriver', 'listFuelType', 'listUser',
    'listInsuranceCompany', 'listTypeCoverage', 'listUtilization', 'listDepartments',
    'listDamageType', 'listInfractions',
];

describe('GappLookupUseCases', () => {
    it.each(METHODS)('%s should delegate to the matching repository method and return its result', async (method) => {
        const repository = new LookupRepositoryPort();
        const expected = [{ id: 1 }];
        repository[method] = jest.fn().mockResolvedValue(expected);

        const useCases = new GappLookupUseCases({ repository });
        const result = await useCases[method]();

        expect(repository[method]).toHaveBeenCalledTimes(1);
        expect(result).toBe(expected);
    });
});
