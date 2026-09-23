/**
 * @fileoverview Testes da ORIGEM da mídia na biblioteca do painel.
 *
 * A grade de produtos é uma linha de `miepp_media` com `type: 'image'`, igual
 * a um upload — o que a distingue é a linha 1:1 em `miepp_product_grids`, que
 * chega como `grid_id` pelo LEFT JOIN. Se o caso de uso não derivar `origin`
 * dali, o painel lista grade e imagem comum como a mesma coisa e manda quem
 * clica para o formulário errado.
 */

const { MieppMediaUseCases } = require('../media/miepp-media.use-cases');
const { MediaRepositoryPort } = require('../media/ports/media-repository.port');

/** Linha como o SELECT com o join devolve: upload não tem grade. */
const UPLOAD_ROW = { id: 1, uuid: 'u-1', title: 'Institucional', type: 'image', grid_id: null };

/** Mesma forma, com a grade presente. O mysql2 pode devolver o id como string. */
const GRID_ROW = { id: 2, uuid: 'u-2', title: 'Ofertas do dia', type: 'image', grid_id: '7' };

class FakeMediaRepository extends MediaRepositoryPort {
    constructor(rows = [UPLOAD_ROW, GRID_ROW]) {
        super();
        this.list = jest.fn(async () => ({ rows, total: rows.length }));
        this.findById = jest.fn(async (id) => rows.find((row) => row.id === Number(id)) || null);
    }
}

function makeUseCases(rows) {
    const repository = new FakeMediaRepository(rows);
    return { repository, useCases: new MieppMediaUseCases({ repository, storage: {} }) };
}

beforeEach(() => jest.clearAllMocks());

describe('origem na listagem', () => {
    it('marca a grade como `generated` e o upload como `upload`', async () => {
        const { useCases } = makeUseCases();

        const { items } = await useCases.list({});

        expect(items.map((row) => row.origin)).toEqual(['upload', 'generated']);
    });

    it('devolve `grid_id` numérico na grade e `null` no upload', async () => {
        // O painel usa o id para abrir o editor da grade; string quebraria a
        // comparação do front e `undefined` sumiria do JSON.
        const { useCases } = makeUseCases();

        const { items } = await useCases.list({});

        expect(items[0].grid_id).toBeNull();
        expect(items[1].grid_id).toBe(7);
    });

    it('repassa o filtro de origem ao repositório', async () => {
        const { useCases, repository } = makeUseCases();

        await useCases.list({ origin: 'generated' });

        expect(repository.list).toHaveBeenCalledWith(
            expect.objectContaining({ origin: 'generated' })
        );
    });

    it('trata origem desconhecida como ausência de filtro', async () => {
        // `?origin=grade` filtrando pelos uploads seria uma resposta plausível
        // e errada — ninguém investigaria uma lista que veio preenchida.
        const { useCases, repository } = makeUseCases();

        await useCases.list({ origin: 'grade' });

        expect(repository.list).toHaveBeenCalledWith(
            expect.objectContaining({ origin: null })
        );
    });
});

describe('origem no detalhe', () => {
    it('sai no GET por id', async () => {
        const { useCases } = makeUseCases();

        expect(await useCases.getById(2)).toMatchObject({ origin: 'generated', grid_id: 7 });
        expect(await useCases.getById(1)).toMatchObject({ origin: 'upload', grid_id: null });
    });
});
