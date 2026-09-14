/**
 * @fileoverview Testes das guardas de playlist — reordenação e exclusão.
 *
 * As duas existem para proteger contra CASCADE silencioso e ordem corrompida,
 * que é o tipo de erro que só aparece na tela da loja.
 */

const { MeippPlaylistUseCases } = require('../playlist/meipp-playlist.use-cases');
const { MeippPlaylistRepositoryPort } = require('../ports/meipp-playlist-repository.port');
const { MediaRepositoryPort } = require('../media/ports/media-repository.port');

const PLAYLIST = { id: 1, name: 'Institucional', active: 1 };

class FakePlaylistRepository extends MeippPlaylistRepositoryPort {
    constructor({ itemIds = [1, 2, 3], scheduleUsage = 0 } = {}) {
        super();
        this.findById = jest.fn(async () => PLAYLIST);
        this.findItemIds = jest.fn(async () => itemIds);
        this.countScheduleUsage = jest.fn(async () => scheduleUsage);
        this.reorderItems = jest.fn(async () => {});
        this.remove = jest.fn(async () => {});
        this.addItem = jest.fn(async () => 10);
    }
}

class FakeMediaRepository extends MediaRepositoryPort {
    constructor(media = { id: 5 }) {
        super();
        this.findById = jest.fn(async () => media);
    }
}

function makeUseCases(options = {}) {
    const repository = new FakePlaylistRepository(options);
    return {
        repository,
        useCases: new MeippPlaylistUseCases({
            repository,
            mediaRepository: new FakeMediaRepository(options.media),
        }),
    };
}

beforeEach(() => jest.clearAllMocks());

describe('reordenação', () => {
    it('grava a ordem quando a lista está completa', async () => {
        const { useCases, repository } = makeUseCases();

        const result = await useCases.reorderItems(1, [3, 1, 2]);

        expect(repository.reorderItems).toHaveBeenCalledWith(1, [3, 1, 2]);
        expect(result.order).toEqual([3, 1, 2]);
    });

    it('recusa lista parcial', async () => {
        // Ordem é posicional: reordenar um subconjunto deixaria os itens de
        // fora com posições duplicadas em relação aos reordenados.
        const { useCases, repository } = makeUseCases();

        await expect(useCases.reorderItems(1, [3, 1])).rejects.toMatchObject({ statusCode: 400 });
        expect(repository.reorderItems).not.toHaveBeenCalled();
    });

    it('recusa ids repetidos', async () => {
        const { useCases, repository } = makeUseCases();

        await expect(useCases.reorderItems(1, [1, 1, 2])).rejects.toMatchObject({ statusCode: 400 });
        expect(repository.reorderItems).not.toHaveBeenCalled();
    });

    it('recusa id de outra playlist', async () => {
        const { useCases, repository } = makeUseCases();

        await expect(useCases.reorderItems(1, [1, 2, 99])).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('99'),
        });
        expect(repository.reorderItems).not.toHaveBeenCalled();
    });

    it('404 quando a playlist não existe', async () => {
        const { useCases, repository } = makeUseCases();
        repository.findById = jest.fn(async () => null);

        await expect(useCases.reorderItems(1, [1, 2, 3])).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('exclusão', () => {
    it('recusa quando há agendamento usando a playlist', async () => {
        // `fk_meipp_schedules_playlist` é ON DELETE CASCADE: sem esta guarda a
        // exclusão levaria os agendamentos junto e as telas parariam sem aviso.
        const { useCases, repository } = makeUseCases({ scheduleUsage: 2 });

        await expect(useCases.remove(1)).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringContaining('2 agendamento'),
        });
        expect(repository.remove).not.toHaveBeenCalled();
    });

    it('exclui quando não há agendamento apontando para ela', async () => {
        const { useCases, repository } = makeUseCases({ scheduleUsage: 0 });

        await expect(useCases.remove(1)).resolves.toEqual({ id: 1 });
        expect(repository.remove).toHaveBeenCalledWith(1);
    });
});

describe('inclusão de item', () => {
    it('404 quando a mídia não existe', async () => {
        const { useCases } = makeUseCases({ media: null });

        await expect(useCases.addItem(1, { media_id: 5 })).rejects.toMatchObject({ statusCode: 404 });
    });
});
