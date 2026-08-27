const { EmployeeUseCases } = require('../employee.use-cases');
const { EmployeeRepositoryPort } = require('../ports/employee-repository.port');
const { ProtheusOrganizationRepositoryPort } = require('../ports/protheus-organization-repository.port');
const { AppError } = require('../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new EmployeeRepositoryPort();
    repo.findEmployeesFiltered = jest.fn().mockResolvedValue({ rows: [{ id: 1, name: 'Fulano' }], totalRecords: 1, limitPage: 1 });
    repo.findUsersFiltered = jest.fn().mockResolvedValue({
        rows: [{ id: 1, name: 'Fulano', registration: '123', status: 1, file_id: null, branch_code: '0101' }],
        totalRecords: 1, limitPage: 1,
    });
    repo.findPhotoRecord = jest.fn().mockResolvedValue({ id: 10, file_path: 'x.webp' });
    repo.attachPhoto = jest.fn().mockResolvedValue({ affectedRows: 1 });
    return Object.assign(repo, overrides);
}

function makeFakeProtheusRepository(overrides = {}) {
    const repo = new ProtheusOrganizationRepositoryPort();
    repo.findOrganizationBatch = jest.fn().mockResolvedValue([]);
    return Object.assign(repo, overrides);
}

function makeUseCases({ repository, protheusRepository } = {}) {
    return new EmployeeUseCases({
        repository: repository ?? makeFakeRepository(),
        protheusRepository: protheusRepository ?? makeFakeProtheusRepository(),
    });
}

describe('EmployeeUseCases', () => {
    describe('getEmployeePhoto', () => {
        it('should throw 404 when there is no photo', async () => {
            const repository = makeFakeRepository({ findPhotoRecord: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.getEmployeePhoto(1)).rejects.toThrow(AppError);
        });

        it('should return the file record when present', async () => {
            const useCases = makeUseCases();
            const record = await useCases.getEmployeePhoto(1);
            expect(record).toEqual({ id: 10, file_path: 'x.webp' });
        });
    });

    describe('updateEmployeePhoto', () => {
        it('should throw 404 when the employee does not exist', async () => {
            const repository = makeFakeRepository({ attachPhoto: jest.fn().mockResolvedValue({ affectedRows: 0 }) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.updateEmployeePhoto(999, {}, 999)).rejects.toThrow(AppError);
        });
    });

    describe('getEmployeesFiltered', () => {
        it('should default page and pageSize', async () => {
            const repository = makeFakeRepository();
            const useCases = makeUseCases({ repository });
            await useCases.getEmployeesFiltered({});
            expect(repository.findEmployeesFiltered).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
        });
    });

    describe('getUsersFiltered', () => {
        it('should return empty results without querying protheus when mysql returns nothing', async () => {
            const repository = makeFakeRepository({ findUsersFiltered: jest.fn().mockResolvedValue({ rows: [], totalRecords: 0, limitPage: 1 }) });
            const protheusRepository = makeFakeProtheusRepository();
            const useCases = makeUseCases({ repository, protheusRepository });

            const result = await useCases.getUsersFiltered({});

            expect(result).toEqual({ data: [], totalRecords: 0, limitPage: 1, page: 1 });
            expect(protheusRepository.findOrganizationBatch).not.toHaveBeenCalled();
        });

        it('should fall back to unenriched data when protheus is unavailable', async () => {
            const protheusRepository = makeFakeProtheusRepository({ findOrganizationBatch: jest.fn().mockRejectedValue(new Error('down')) });
            const useCases = makeUseCases({ protheusRepository });

            const result = await useCases.getUsersFiltered({});

            expect(result.data).toHaveLength(1);
            expect(result.data[0].company_name).toBeNull();
        });

        it('should not query protheus for users without a registration', async () => {
            const repository = makeFakeRepository({
                findUsersFiltered: jest.fn().mockResolvedValue({
                    rows: [{ id: 1, name: 'Sem matrícula', registration: null, status: 1, file_id: null, branch_code: null }],
                    totalRecords: 1, limitPage: 1,
                }),
            });
            const protheusRepository = makeFakeProtheusRepository();
            const useCases = makeUseCases({ repository, protheusRepository });

            await useCases.getUsersFiltered({});

            expect(protheusRepository.findOrganizationBatch).not.toHaveBeenCalled();
        });
    });
});
