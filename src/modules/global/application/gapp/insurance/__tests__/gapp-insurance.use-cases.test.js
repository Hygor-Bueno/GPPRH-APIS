const { GappInsuranceUseCases } = require('../gapp-insurance.use-cases');
const { GappInsuranceRepositoryPort } = require('../../ports/gapp-insurance-repository.port');
const { GappUserRepositoryPort } = require('../../ports/gapp-user-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

const GAPP_USER = { user_id: 10, work_group_fk: 5 };
const CURRENT_USER = { id: 1 };

function makeFakeRepository(overrides = {}) {
    const repo = new GappInsuranceRepositoryPort();
    repo.saveInsurancePolicy = jest.fn().mockResolvedValue({ id: 1 });
    repo.list = jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    repo.getById = jest.fn().mockResolvedValue({ id_insurance: 1 });
    repo.findVehicleWorkGroup = jest.fn().mockResolvedValue({ work_group_fk: 5 });
    repo.findInsuranceWorkGroup = jest.fn().mockResolvedValue({ work_group_fk: 5 });
    return Object.assign(repo, overrides);
}

function makeFakeUserRepository(overrides = {}) {
    const repo = new GappUserRepositoryPort();
    repo.findAuthByAccessCode = jest.fn().mockResolvedValue(GAPP_USER);
    return Object.assign(repo, overrides);
}

describe('GappInsuranceUseCases', () => {
    describe('save — ownership guard (correção da falha de escopo)', () => {
        it('should throw 404 on create when the vehicle belongs to another work group', async () => {
            const repository = makeFakeRepository({ findVehicleWorkGroup: jest.fn().mockResolvedValue({ work_group_fk: 999 }) });
            const useCases = new GappInsuranceUseCases({ repository, userRepository: makeFakeUserRepository() });

            await expect(useCases.save({ is_update: 0, active_id_fk: 200 }, CURRENT_USER)).rejects.toThrow(AppError);
            expect(repository.saveInsurancePolicy).not.toHaveBeenCalled();
        });

        it('should throw 404 on create when the vehicle does not exist', async () => {
            const repository = makeFakeRepository({ findVehicleWorkGroup: jest.fn().mockResolvedValue(null) });
            const useCases = new GappInsuranceUseCases({ repository, userRepository: makeFakeUserRepository() });

            await expect(useCases.save({ is_update: 0, active_id_fk: 999 }, CURRENT_USER)).rejects.toThrow(AppError);
        });

        it('should throw 404 on update when the insurance belongs to another work group', async () => {
            const repository = makeFakeRepository({ findInsuranceWorkGroup: jest.fn().mockResolvedValue({ work_group_fk: 999 }) });
            const useCases = new GappInsuranceUseCases({ repository, userRepository: makeFakeUserRepository() });

            await expect(useCases.save({ is_update: 1, id_insurance: 1 }, CURRENT_USER)).rejects.toThrow(AppError);
            expect(repository.saveInsurancePolicy).not.toHaveBeenCalled();
        });

        it('should save when ownership matches', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappInsuranceUseCases({ repository, userRepository: makeFakeUserRepository() });

            const result = await useCases.save({ is_update: 0, active_id_fk: 200 }, CURRENT_USER);

            expect(repository.saveInsurancePolicy).toHaveBeenCalled();
            expect(result).toEqual({ id: 1 });
        });
    });

    describe('list', () => {
        it('should scope filters by the resolved work_group_fk', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappInsuranceUseCases({ repository, userRepository: makeFakeUserRepository() });

            await useCases.list({ work_group_fk: 999 }, CURRENT_USER);

            expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ work_group_fk: GAPP_USER.work_group_fk }));
        });
    });

    describe('getById', () => {
        it('should pass the resolved work_group_fk and throw 404 when not found', async () => {
            const repository = makeFakeRepository({ getById: jest.fn().mockResolvedValue(null) });
            const useCases = new GappInsuranceUseCases({ repository, userRepository: makeFakeUserRepository() });

            await expect(useCases.getById(999, CURRENT_USER)).rejects.toThrow(AppError);
            expect(repository.getById).toHaveBeenCalledWith(999, GAPP_USER.work_group_fk);
        });
    });
});
