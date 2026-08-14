const { GtppThemeUseCases } = require('../gtpp-theme.use-cases');
const { ThemeRepositoryPort } = require('../ports/theme-repository.port');
const { AppError } = require('../../../../../../errors/app.error');

function makeFakeRepository(overrides = {}) {
    const repo = new ThemeRepositoryPort();
    repo.findAll = jest.fn().mockResolvedValue([{ id_theme: 1 }]);
    repo.findById = jest.fn().mockResolvedValue({ id_theme: 1, description_theme: 'Escuro' });
    repo.findByUser = jest.fn().mockResolvedValue([{ id_theme: 1 }]);
    repo.insert = jest.fn().mockResolvedValue({ insertId: 1 });
    repo.update = jest.fn().mockResolvedValue({ updated: 1 });
    repo.remove = jest.fn().mockResolvedValue({ deleted: 1 });
    return Object.assign(repo, overrides);
}

describe('GtppThemeUseCases', () => {
    it('getThemeById should throw 404 when not found', async () => {
        const repository = makeFakeRepository({ findById: jest.fn().mockResolvedValue(null) });
        const useCases = new GtppThemeUseCases({ repository });
        await expect(useCases.getThemeById(999)).rejects.toThrow(AppError);
    });

    it('createTheme should throw 400 when description is blank', async () => {
        const useCases = new GtppThemeUseCases({ repository: makeFakeRepository() });
        await expect(useCases.createTheme(1, '   ')).rejects.toThrow(AppError);
    });

    it('createTheme should insert and return the new id', async () => {
        const repository = makeFakeRepository();
        const useCases = new GtppThemeUseCases({ repository });
        const result = await useCases.createTheme(1, 'Escuro');
        expect(repository.insert).toHaveBeenCalledWith('Escuro', 1);
        expect(result).toEqual({ themeId: 1 });
    });

    it('updateTheme should throw 404 when nothing updated', async () => {
        const repository = makeFakeRepository({ update: jest.fn().mockResolvedValue({ updated: 0 }) });
        const useCases = new GtppThemeUseCases({ repository });
        await expect(useCases.updateTheme(999, 'X')).rejects.toThrow(AppError);
    });

    it('deleteTheme should throw 404 when nothing deleted', async () => {
        const repository = makeFakeRepository({ remove: jest.fn().mockResolvedValue({ deleted: 0 }) });
        const useCases = new GtppThemeUseCases({ repository });
        await expect(useCases.deleteTheme(999)).rejects.toThrow(AppError);
    });
});
