const { GappActiveUseCases } = require('../gapp-active.use-cases');
const { ActiveRepositoryPort } = require('../ports/active-repository.port');
const { GappUserRepositoryPort } = require('../../ports/gapp-user-repository.port');
const { GappInsuranceRepositoryPort } = require('../../ports/gapp-insurance-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

const GAPP_USER = { user_id: 10, work_group_fk: 5 };
const CURRENT_USER = { id: 1 };

function makeFakeRepository(overrides = {}) {
    const repo = new ActiveRepositoryPort();
    repo.findIsVehicleByActiveId = jest.fn().mockResolvedValue({ is_vehicle: 1 });
    repo.saveActive = jest.fn().mockResolvedValue({ id: 100, insurance_id: null });
    repo.list = jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    repo.findById = jest.fn().mockResolvedValue({ active_id: 100, is_vehicle: 0 });
    repo.findVehicleByActiveId = jest.fn().mockResolvedValue({ vehicle_id: 200 });
    return Object.assign(repo, overrides);
}

function makeFakeUserRepository(overrides = {}) {
    const repo = new GappUserRepositoryPort();
    repo.findAuthByAccessCode = jest.fn().mockResolvedValue(GAPP_USER);
    return Object.assign(repo, overrides);
}

function makeFakeInsuranceRepository(overrides = {}) {
    const repo = new GappInsuranceRepositoryPort();
    repo.findActiveInsuranceByActiveId = jest.fn().mockResolvedValue({ id_insurance: 1 });
    return Object.assign(repo, overrides);
}

describe('GappActiveUseCases', () => {
    describe('_resolveGappUser (via save)', () => {
        it('should throw 404 when the authenticated user is not registered in GAPP', async () => {
            const userRepository = makeFakeUserRepository({ findAuthByAccessCode: jest.fn().mockResolvedValue(null) });
            const useCases = new GappActiveUseCases({
                repository: makeFakeRepository(), userRepository, insuranceRepository: makeFakeInsuranceRepository()
            });

            await expect(useCases.save({}, CURRENT_USER)).rejects.toThrow(AppError);
        });
    });

    describe('save', () => {
        it('should never use user_id_fk/work_group_fk from the body', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappActiveUseCases({
                repository, userRepository: makeFakeUserRepository(), insuranceRepository: makeFakeInsuranceRepository()
            });

            await useCases.save({ brand: 'X', user_id_fk: 999, work_group_fk: 999 }, CURRENT_USER);

            expect(repository.saveActive).toHaveBeenCalledWith(
                expect.objectContaining({ user_id_fk: GAPP_USER.user_id, work_group_fk: GAPP_USER.work_group_fk })
            );
        });

        it('should preserve current is_vehicle on update when not sent', async () => {
            const repository = makeFakeRepository({ findIsVehicleByActiveId: jest.fn().mockResolvedValue({ is_vehicle: 1 }) });
            const useCases = new GappActiveUseCases({
                repository, userRepository: makeFakeUserRepository(), insuranceRepository: makeFakeInsuranceRepository()
            });

            await useCases.save({ active_id: 100 }, CURRENT_USER);

            expect(repository.saveActive).toHaveBeenCalledWith(expect.objectContaining({ is_vehicle: 1 }));
        });

        it('should throw 404 when active_id is sent but not found', async () => {
            const repository = makeFakeRepository({ findIsVehicleByActiveId: jest.fn().mockResolvedValue(null) });
            const useCases = new GappActiveUseCases({
                repository, userRepository: makeFakeUserRepository(), insuranceRepository: makeFakeInsuranceRepository()
            });

            await expect(useCases.save({ active_id: 999 }, CURRENT_USER)).rejects.toThrow(AppError);
        });
    });

    describe('list', () => {
        it('should scope filters by the resolved work_group_fk, never from query filters', async () => {
            const repository = makeFakeRepository();
            const useCases = new GappActiveUseCases({
                repository, userRepository: makeFakeUserRepository(), insuranceRepository: makeFakeInsuranceRepository()
            });

            await useCases.list({ work_group_fk: 999, brand: 'X' }, CURRENT_USER);

            expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ work_group_fk: GAPP_USER.work_group_fk }));
        });
    });

    describe('getById', () => {
        it('should throw 404 when not found in the user work_group', async () => {
            const repository = makeFakeRepository({ findById: jest.fn().mockResolvedValue(null) });
            const useCases = new GappActiveUseCases({
                repository, userRepository: makeFakeUserRepository(), insuranceRepository: makeFakeInsuranceRepository()
            });

            await expect(useCases.getById(1, CURRENT_USER)).rejects.toThrow(AppError);
        });

        it('should attach vehicle and insurance only when is_vehicle === 1', async () => {
            const repository = makeFakeRepository({ findById: jest.fn().mockResolvedValue({ active_id: 1, is_vehicle: 1 }) });
            const insuranceRepository = makeFakeInsuranceRepository();
            const useCases = new GappActiveUseCases({ repository, userRepository: makeFakeUserRepository(), insuranceRepository });

            const result = await useCases.getById(1, CURRENT_USER);

            expect(result.vehicle).toEqual({ vehicle_id: 200 });
            expect(insuranceRepository.findActiveInsuranceByActiveId).toHaveBeenCalledWith(200);
            expect(result.insurance).toEqual({ id_insurance: 1 });
        });

        it('should not attach vehicle/insurance when is_vehicle !== 1', async () => {
            const repository = makeFakeRepository({ findById: jest.fn().mockResolvedValue({ active_id: 1, is_vehicle: 0 }) });
            const useCases = new GappActiveUseCases({
                repository, userRepository: makeFakeUserRepository(), insuranceRepository: makeFakeInsuranceRepository()
            });

            const result = await useCases.getById(1, CURRENT_USER);

            expect(result.vehicle).toBeUndefined();
            expect(repository.findVehicleByActiveId).not.toHaveBeenCalled();
        });
    });
});
