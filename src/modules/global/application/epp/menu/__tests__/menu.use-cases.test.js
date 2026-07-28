const { EppMenuUseCases } = require('../menu.use-cases');
const { MenuRepositoryPort } = require('../ports/menu-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new MenuRepositoryPort();
    repo.findActiveMenus = jest.fn().mockResolvedValue([{ id_menu: 1 }]);
    repo.findAllMenus = jest.fn().mockResolvedValue([{ id_menu: 1 }, { id_menu: 2 }]);
    repo.searchMenus = jest.fn().mockResolvedValue([{ id_menu: 1 }]);
    repo.menuExists = jest.fn().mockResolvedValue(true);
    repo.findMenuById = jest.fn().mockResolvedValue({ id_menu: 1, description: 'Menu 1' });
    repo.insertMenu = jest.fn().mockResolvedValue({ insertId: 1 });
    repo.updateMenu = jest.fn().mockResolvedValue({ updated: 1 });
    repo.hasLinkedLogMenus = jest.fn().mockResolvedValue(false);
    repo.deleteMenu = jest.fn().mockResolvedValue(undefined);
    repo.findLogMenus = jest.fn().mockResolvedValue([]);
    repo.findLogMenusByPlu = jest.fn().mockResolvedValue([]);
    repo.findLogMenuById = jest.fn().mockResolvedValue({ epp_log_id: 1 });
    repo.insertLogMenu = jest.fn().mockResolvedValue({ insertId: 1 });
    repo.updateLogMenu = jest.fn().mockResolvedValue({ updated: 1 });
    repo.deleteLogMenuById = jest.fn().mockResolvedValue({ deleted: 1 });
    repo.deleteLogMenuByPlu = jest.fn().mockResolvedValue({ deleted: 2 });
    return Object.assign(repo, overrides);
}

describe('EppMenuUseCases', () => {
    describe('createMenu', () => {
        it('should insert then refetch by id', async () => {
            const repository = makeFakeRepository();
            const useCases = new EppMenuUseCases({ repository });

            const result = await useCases.createMenu({ description: 'Menu 1' });

            expect(repository.insertMenu).toHaveBeenCalledWith({ description: 'Menu 1', status: 1 });
            expect(repository.findMenuById).toHaveBeenCalledWith(1);
            expect(result).toEqual({ id_menu: 1, description: 'Menu 1' });
        });
    });

    describe('updateMenu', () => {
        it('should throw 404 AppError when nothing was updated', async () => {
            const repository = makeFakeRepository({ updateMenu: jest.fn().mockResolvedValue({ updated: 0 }) });
            const useCases = new EppMenuUseCases({ repository });

            await expect(useCases.updateMenu(99, { description: 'X', status: 1 })).rejects.toThrow(AppError);
        });
    });

    describe('deleteMenu', () => {
        it('should throw 404 when menu does not exist', async () => {
            const repository = makeFakeRepository({ menuExists: jest.fn().mockResolvedValue(false) });
            const useCases = new EppMenuUseCases({ repository });

            await expect(useCases.deleteMenu(1)).rejects.toThrow(AppError);
            expect(repository.hasLinkedLogMenus).not.toHaveBeenCalled();
        });

        it('should throw 409 when menu has linked log_menus', async () => {
            const repository = makeFakeRepository({ hasLinkedLogMenus: jest.fn().mockResolvedValue(true) });
            const useCases = new EppMenuUseCases({ repository });

            await expect(useCases.deleteMenu(1)).rejects.toThrow(AppError);
            expect(repository.deleteMenu).not.toHaveBeenCalled();
        });

        it('should delete when menu exists and has no linked log_menus', async () => {
            const repository = makeFakeRepository();
            const useCases = new EppMenuUseCases({ repository });

            const result = await useCases.deleteMenu(1);

            expect(repository.deleteMenu).toHaveBeenCalledWith(1);
            expect(result).toEqual({ deleted: true });
        });
    });

    describe('deleteLogMenuById', () => {
        it('should throw 404 when nothing was deleted', async () => {
            const repository = makeFakeRepository({ deleteLogMenuById: jest.fn().mockResolvedValue({ deleted: 0 }) });
            const useCases = new EppMenuUseCases({ repository });

            await expect(useCases.deleteLogMenuById(1)).rejects.toThrow(AppError);
        });
    });
});
