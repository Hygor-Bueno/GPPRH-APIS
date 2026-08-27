const { GappVehicleUseCases } = require('../gapp-vehicle.use-cases');
const { VehicleRepositoryPort } = require('../ports/vehicle-repository.port');
const { GappUserRepositoryPort } = require('../../ports/gapp-user-repository.port');
const { GappInsuranceRepositoryPort } = require('../../ports/gapp-insurance-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

const GAPP_USER = { user_id: 10, work_group_fk: 5 };
const CURRENT_USER = { id: 1 };

function makeFakeRepository(overrides = {}) {
    const repo = new VehicleRepositoryPort();
    repo.list = jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    repo.findById = jest.fn().mockResolvedValue({ vehicle_id: 200 });
    return Object.assign(repo, overrides);
}

function makeFakeUserRepository(overrides = {}) {
    const repo = new GappUserRepositoryPort();
    repo.findAuthByAccessCode = jest.fn().mockResolvedValue(GAPP_USER);
    return Object.assign(repo, overrides);
}

function makeFakeInsuranceRepository(overrides = {}) {
    const repo = new GappInsuranceRepositoryPort();
    repo.findActiveInsuranceByVehicleId = jest.fn().mockResolvedValue({ id_insurance: 1 });
    return Object.assign(repo, overrides);
}

describe('GappVehicleUseCases', () => {
    describe('list', () => {
        it('should scope filters by the resolved work_group_fk, never from query filters', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappVehicleUseCases({
                repository, userRepository: makeFakeUserRepository(), insuranceRepository: makeFakeInsuranceRepository()
            });

            await useCases.list({ work_group_fk: 999 }, CURRENT_USER);

            expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ work_group_fk: GAPP_USER.work_group_fk }));
        });
    });

    describe('getById', () => {
        it('should pass the resolved work_group_fk and throw 404 when not found (correção da falha de escopo)', async () => {
            const repository = makeFakeRepository({ findById: jest.fn().mockResolvedValue(null) });
            const useCases = new GappVehicleUseCases({
                repository, userRepository: makeFakeUserRepository(), insuranceRepository: makeFakeInsuranceRepository()
            });

            await expect(useCases.getById(999, CURRENT_USER)).rejects.toThrow(AppError);
            expect(repository.findById).toHaveBeenCalledWith(999, GAPP_USER.work_group_fk);
        });

        it('should attach the active insurance for the vehicle', async () => {
            const repository = makeFakeRepository();
            const insuranceRepository = makeFakeInsuranceRepository();
            const useCases = new GappVehicleUseCases({ repository, userRepository: makeFakeUserRepository(), insuranceRepository });

            const result = await useCases.getById(200, CURRENT_USER);

            expect(insuranceRepository.findActiveInsuranceByVehicleId).toHaveBeenCalledWith(200);
            expect(result.insurance).toEqual({ id_insurance: 1 });
        });

        it('should set insurance to null when there is none', async () => {
            const repository = makeFakeRepository();
            const insuranceRepository = makeFakeInsuranceRepository({ findActiveInsuranceByVehicleId: jest.fn().mockResolvedValue(null) });
            const useCases = new GappVehicleUseCases({ repository, userRepository: makeFakeUserRepository(), insuranceRepository });

            const result = await useCases.getById(200, CURRENT_USER);

            expect(result.insurance).toBeNull();
        });
    });
});
