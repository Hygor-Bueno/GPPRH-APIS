/**
 * @fileoverview Testes das pastas da biblioteca de mídia.
 *
 * O foco é o que o banco NÃO garante: ciclo, profundidade e a distinção entre
 * "campo ausente" (manter) e `null` (raiz). Nome repetido e pasta não vazia o
 * banco também recusa — aqui se testa que a recusa chega com a explicação.
 */

const { MieppMediaFolderUseCases } = require('../media/miepp-media-folder.use-cases');
const { MieppMediaUseCases } = require('../media/miepp-media.use-cases');
const { MediaFolderRepositoryPort } = require('../media/ports/media-folder-repository.port');
const { MediaRepositoryPort } = require('../media/ports/media-repository.port');
const {
    normalizeFolderFilter,
    normalizeFolderId,
    MAX_FOLDER_DEPTH,
} = require('../../../domain/miepp/media/media-folder.rules');

/**
 * Árvore em memória: 1 Campanhas > 2 Natal > 3 Loja 3 ; 4 Institucional.
 * `getPath` e `getSubtreeHeight` percorrem de verdade, para que o teste de
 * ciclo exercite o caminho real e não um valor fixo.
 */
class FakeFolderRepository extends MediaFolderRepositoryPort {
    constructor() {
        super();
        this.rows = new Map([
            [1, { id: 1, parent_id: null, name: 'Campanhas', folder_count: 1, media_count: 0 }],
            [2, { id: 2, parent_id: 1, name: 'Natal', folder_count: 1, media_count: 2 }],
            [3, { id: 3, parent_id: 2, name: 'Loja 3', folder_count: 0, media_count: 0 }],
            [4, { id: 4, parent_id: null, name: 'Institucional', folder_count: 0, media_count: 0 }],
        ]);
        this.findById = jest.fn(async (id) => this.rows.get(Number(id)) || null);
        this.create = jest.fn(async () => 99);
        this.update = jest.fn(async () => {});
        this.remove = jest.fn(async () => {});
        this.list = jest.fn(async () => [...this.rows.values()]);
        this.countRoot = jest.fn(async () => ({ folder_count: 2, media_count: 5 }));
    }

    async getPath(id) {
        const path = [];
        let node = this.rows.get(Number(id));
        while (node) {
            path.unshift({ id: node.id, name: node.name });
            node = node.parent_id === null ? null : this.rows.get(node.parent_id);
        }
        return path;
    }

    async getSubtreeHeight(id) {
        const children = [...this.rows.values()].filter((row) => row.parent_id === Number(id));
        if (children.length === 0) return 1;
        const heights = await Promise.all(children.map((child) => this.getSubtreeHeight(child.id)));
        return 1 + Math.max(...heights);
    }
}

function makeFolderUseCases() {
    const repository = new FakeFolderRepository();
    // Depois do create, o getById procura o id novo.
    repository.rows.set(99, { id: 99, parent_id: null, name: 'Nova', folder_count: 0, media_count: 0 });
    return { repository, useCases: new MieppMediaFolderUseCases({ repository }) };
}

beforeEach(() => jest.clearAllMocks());

describe('regras de filtro e de id', () => {
    it('sem `folder_id` a listagem não filtra', () => {
        expect(normalizeFolderFilter(undefined)).toEqual({ mode: 'all', folderId: null });
    });

    it('`root` pede só o que está fora de pasta', () => {
        expect(normalizeFolderFilter('root')).toEqual({ mode: 'root', folderId: null });
    });

    it('filtro inválido é 400, e não a biblioteca inteira', () => {
        // Devolver tudo dentro de uma pasta aberta faria o usuário concluir que
        // a pasta contém a biblioteca.
        expect(() => normalizeFolderFilter('abc')).toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it('distingue ausente (manter) de null (raiz)', () => {
        expect(normalizeFolderId(undefined)).toBeUndefined();
        expect(normalizeFolderId(null)).toBeNull();
        expect(normalizeFolderId('')).toBeNull();
        expect(normalizeFolderId('root')).toBeNull();
        expect(normalizeFolderId('7')).toBe(7);
    });
});

describe('criar pasta', () => {
    it('cria na raiz quando não vem `parent_id`', async () => {
        const { useCases, repository } = makeFolderUseCases();

        await useCases.create({ name: '  Nova  ' }, { id: 12 });

        expect(repository.create).toHaveBeenCalledWith({ parent_id: null, name: 'Nova', created_by: 12 });
    });

    it('recusa nome só de espaços', async () => {
        const { useCases } = makeFolderUseCases();

        await expect(useCases.create({ name: '   ' })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('recusa pai inexistente com 404', async () => {
        const { useCases, repository } = makeFolderUseCases();

        await expect(useCases.create({ name: 'X', parent_id: 500 })).rejects.toMatchObject({ statusCode: 404 });
        expect(repository.create).not.toHaveBeenCalled();
    });

    it('recusa passar do teto de profundidade', async () => {
        const { useCases, repository } = makeFolderUseCases();
        // Cadeia 10 > 11 > ... até o teto.
        let parent = null;
        for (let i = 0; i < MAX_FOLDER_DEPTH; i += 1) {
            const id = 10 + i;
            repository.rows.set(id, { id, parent_id: parent, name: `n${i}`, folder_count: 0, media_count: 0 });
            parent = id;
        }

        await expect(useCases.create({ name: 'fundo demais', parent_id: parent }))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('mover pasta', () => {
    it('recusa mover para dentro de uma subpasta dela (ciclo)', async () => {
        // Campanhas (1) para dentro de Loja 3 (3), que é neta dela.
        const { useCases, repository } = makeFolderUseCases();

        await expect(useCases.update(1, { parent_id: 3 })).rejects.toMatchObject({ statusCode: 409 });
        expect(repository.update).not.toHaveBeenCalled();
    });

    it('recusa mover para dentro dela mesma', async () => {
        const { useCases } = makeFolderUseCases();

        await expect(useCases.update(2, { parent_id: 2 })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('`parent_id` ausente mantém o lugar ao renomear', async () => {
        const { useCases, repository } = makeFolderUseCases();

        await useCases.update(3, { name: 'Loja 03' });

        expect(repository.update).toHaveBeenCalledWith(3, { parent_id: 2, name: 'Loja 03' });
    });

    it('`parent_id: null` leva para a raiz', async () => {
        const { useCases, repository } = makeFolderUseCases();

        await useCases.update(3, { parent_id: null });

        expect(repository.update).toHaveBeenCalledWith(3, { parent_id: null, name: 'Loja 3' });
    });

    it('conta as subpastas que vão junto contra o teto', async () => {
        // Campanhas tem 3 níveis (1 > 2 > 3). Colocá-la sob uma pasta de
        // profundidade 3 daria 6 > 5.
        const { useCases, repository } = makeFolderUseCases();
        repository.rows.set(20, { id: 20, parent_id: 4, name: 'a', folder_count: 0, media_count: 0 });
        repository.rows.set(21, { id: 21, parent_id: 20, name: 'b', folder_count: 0, media_count: 0 });

        await expect(useCases.update(1, { parent_id: 21 })).rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('excluir pasta', () => {
    it('recusa pasta com conteúdo, dizendo quanto há', async () => {
        const { useCases, repository } = makeFolderUseCases();

        await expect(useCases.remove(2)).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringContaining('1 subpasta(s), 2 mídia(s)'),
        });
        expect(repository.remove).not.toHaveBeenCalled();
    });

    it('exclui pasta vazia', async () => {
        const { useCases, repository } = makeFolderUseCases();

        await expect(useCases.remove(4)).resolves.toEqual({ id: 4 });
        expect(repository.remove).toHaveBeenCalledWith(4);
    });
});

describe('listar e detalhar', () => {
    it('devolve a árvore achatada com as contagens da raiz', async () => {
        const { useCases } = makeFolderUseCases();

        const result = await useCases.list();

        expect(result.root).toEqual({ folder_count: 2, media_count: 5 });
        expect(result.items.length).toBeGreaterThan(0);
    });

    it('traz o caminho da raiz até a pasta', async () => {
        const { useCases } = makeFolderUseCases();

        const folder = await useCases.getById(3);

        expect(folder.path.map((node) => node.name)).toEqual(['Campanhas', 'Natal', 'Loja 3']);
    });
});

// ─── Mídia dentro de pasta ───────────────────────────────────────────────────

class FakeMediaRepository extends MediaRepositoryPort {
    constructor() {
        super();
        this.rows = new Map([
            [1, { id: 1, title: 'A', folder_id: 2, duration_seconds: 10, status: 'ready', grid_id: null }],
            [2, { id: 2, title: 'B', folder_id: null, duration_seconds: 10, status: 'ready', grid_id: null }],
        ]);
        this.list = jest.fn(async () => ({ rows: [], total: 0 }));
        this.findById = jest.fn(async (id) => this.rows.get(Number(id)) || null);
        this.update = jest.fn(async () => {});
        this.findExistingIds = jest.fn(async (ids) => ids.filter((id) => this.rows.has(id)));
        this.moveToFolder = jest.fn(async (ids) => ids.length);
    }
}

function makeMediaUseCases() {
    const repository = new FakeMediaRepository();
    const folderRepository = new FakeFolderRepository();
    const useCases = new MieppMediaUseCases({ repository, storage: {}, folderRepository });
    return { repository, useCases };
}

describe('mídia: filtro de pasta na listagem', () => {
    it('repassa `root` ao repositório', async () => {
        const { useCases, repository } = makeMediaUseCases();

        await useCases.list({ folder_id: 'root' });

        expect(repository.list).toHaveBeenCalledWith(
            expect.objectContaining({ folderMode: 'root', folderId: null })
        );
    });
});

describe('mídia: editar pasta', () => {
    it('`folder_id` ausente mantém a pasta atual', async () => {
        const { useCases, repository } = makeMediaUseCases();

        await useCases.update(1, { title: 'A2' });

        expect(repository.update).toHaveBeenCalledWith(1, expect.objectContaining({ folder_id: 2 }));
    });

    it('`folder_id: null` leva para a raiz', async () => {
        const { useCases, repository } = makeMediaUseCases();

        await useCases.update(1, { folder_id: null });

        expect(repository.update).toHaveBeenCalledWith(1, expect.objectContaining({ folder_id: null }));
    });

    it('pasta inexistente é 404 antes de gravar', async () => {
        const { useCases, repository } = makeMediaUseCases();

        await expect(useCases.update(1, { folder_id: 500 })).rejects.toMatchObject({ statusCode: 404 });
        expect(repository.update).not.toHaveBeenCalled();
    });
});

describe('mídia: mover em lote', () => {
    it('move todas para a pasta', async () => {
        const { useCases, repository } = makeMediaUseCases();

        const result = await useCases.moveMany({ media_ids: [1, 2, 2], folder_id: 4 });

        expect(repository.moveToFolder).toHaveBeenCalledWith([1, 2], 4);
        expect(result).toEqual({ folder_id: 4, media_ids: [1, 2], moved: 2 });
    });

    it('é tudo ou nada: id inexistente não move nenhuma', async () => {
        const { useCases, repository } = makeMediaUseCases();

        await expect(useCases.moveMany({ media_ids: [1, 77], folder_id: 4 }))
            .rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining('77') });
        expect(repository.moveToFolder).not.toHaveBeenCalled();
    });

    it('exige `folder_id` explícito — ausente não vira raiz', async () => {
        const { useCases, repository } = makeMediaUseCases();

        await expect(useCases.moveMany({ media_ids: [1] })).rejects.toMatchObject({ statusCode: 400 });
        expect(repository.moveToFolder).not.toHaveBeenCalled();
    });

    it('aceita `folder_id: null` para a raiz', async () => {
        const { useCases, repository } = makeMediaUseCases();

        await useCases.moveMany({ media_ids: [1], folder_id: null });

        expect(repository.moveToFolder).toHaveBeenCalledWith([1], null);
    });

    it('recusa lista vazia', async () => {
        const { useCases } = makeMediaUseCases();

        await expect(useCases.moveMany({ media_ids: [], folder_id: null })).rejects.toMatchObject({ statusCode: 400 });
    });
});
