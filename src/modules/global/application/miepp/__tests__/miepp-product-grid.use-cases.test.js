/**
 * @fileoverview Testes da grade de produtos.
 *
 * O foco é a regra que sustenta o desenho inteiro: a grade guarda ESCOLHA, não
 * produto. Se um dia alguém aceitar `price` no payload "só para adiantar", o
 * módulo passa a ter preço em duas fontes e é aí que a parede começa a mentir.
 * Os demais casos cobrem o que quebra silencioso — capacidade, duplicidade e o
 * CASCADE da playlist.
 */

const { MieppProductGridUseCases } = require('../product-grid/miepp-product-grid.use-cases');
const { ProductGridRepositoryPort } = require('../product-grid/ports/product-grid-repository.port');

const GRID_ROW = {
    id: 7,
    media_id: 42,
    shop_id: 2,
    background_file_id: null,
    grid_columns: 3,
    grid_rows: 3,
    stale_after_minutes: 20,
    data_hash: null,
    last_checked_at: null,
    last_rendered_at: null,
    last_error: null,
    active: 1,
    created_by: 1,
    created_at: '2026-09-16 10:00:00',
    updated_at: '2026-09-16 10:00:00',
    stale: 1,
    media_uuid: 'uuid-da-grade',
    title: 'Ofertas corredor 3',
    media_status: 'processing',
    duration_seconds: 15,
};

class FakeGridRepository extends ProductGridRepositoryPort {
    constructor({ grid = GRID_ROW, items = [], usage = 0 } = {}) {
        super();
        this.findById = jest.fn(async () => grid);
        this.findItems = jest.fn(async () => items);
        this.create = jest.fn(async () => 7);
        this.update = jest.fn(async () => {});
        this.setBackground = jest.fn(async () => {});
        this.requestRender = jest.fn(async () => {});
        this.countUsage = jest.fn(async () => usage);
        this.remove = jest.fn(async () => {});
        this.listRenders = jest.fn(async () => ({ rows: [], total: 0 }));
    }
}

function makeUseCases(options = {}) {
    const repository = new FakeGridRepository(options);
    return { repository, useCases: new MieppProductGridUseCases({ repository }) };
}

const ATOR = { id: 1 };

function payload(overrides = {}) {
    return {
        title: 'Ofertas corredor 3',
        shop_id: 2,
        items: [{ plu: 481233 }, { plu: 190877 }],
        ...overrides,
    };
}

beforeEach(() => jest.clearAllMocks());

describe('a grade guarda escolha, não produto', () => {
    it('recusa preço no item em vez de ignorá-lo em silêncio', async () => {
        const { useCases, repository } = makeUseCases();

        await expect(useCases.create(payload({
            items: [{ plu: 481233, description: 'REFRIG COLA PET 2L', price: 8.49 }],
        }), ATOR)).rejects.toMatchObject({ statusCode: 400 });

        // O ponto do teste: nada foi gravado. Ignorar os campos e seguir seria
        // pior que o 400 — o front acreditaria que o preço está guardado.
        expect(repository.create).not.toHaveBeenCalled();
    });

    it('a mensagem diz QUAIS campos sobraram, para o front saber o que tirar', async () => {
        const { useCases } = makeUseCases();

        await expect(useCases.create(payload({
            items: [{ plu: 481233, price: 8.49, barcode: '789' }],
        }), ATOR)).rejects.toThrow(/price.*barcode|barcode.*price/);
    });

    it('aceita o que é curadoria: plu, ordem e texto do editor', async () => {
        const { useCases, repository } = makeUseCases();

        await useCases.create(payload({
            items: [{ plu: 481233, label_override: 'Oferta da semana' }],
        }), ATOR);

        expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
            items: [{ plu: 481233, order_index: 0, label_override: 'Oferta da semana' }],
        }));
    });
});

describe('itens', () => {
    it('reindexa a ordem para 0..n-1, sem buraco nem empate', async () => {
        const { useCases, repository } = makeUseCases();

        await useCases.create(payload({
            items: [
                { plu: 3, order_index: 50 },
                { plu: 1, order_index: 2 },
                { plu: 2, order_index: 9 },
            ],
        }), ATOR);

        expect(repository.create.mock.calls[0][0].items).toEqual([
            { plu: 1, order_index: 0, label_override: null },
            { plu: 2, order_index: 1, label_override: null },
            { plu: 3, order_index: 2, label_override: null },
        ]);
    });

    it('label_override em branco vira null — "usar a descrição do Consinco"', async () => {
        const { useCases, repository } = makeUseCases();

        await useCases.create(payload({ items: [{ plu: 1, label_override: '   ' }] }), ATOR);

        expect(repository.create.mock.calls[0][0].items[0].label_override).toBeNull();
    });

    it('recusa PLU repetido dizendo qual é, em vez de deixar o 1062 virar 500', async () => {
        const { useCases } = makeUseCases();

        await expect(useCases.create(payload({
            items: [{ plu: 481233 }, { plu: 481233 }],
        }), ATOR)).rejects.toThrow(/481233/);
    });

    it('recusa mais itens do que cabe no layout', async () => {
        const { useCases } = makeUseCases();

        await expect(useCases.create(payload({
            grid_columns: 2,
            grid_rows: 1,
            items: [{ plu: 1 }, { plu: 2 }, { plu: 3 }],
        }), ATOR)).rejects.toThrow(/2 produtos/);
    });

    it('encolher o layout com os itens já gravados é recusado', async () => {
        // O `items` não vem no PUT, então a validação precisa rodar contra a
        // lista que está no banco — senão a grade fica com 9 itens num 2x2 e o
        // render é que descobre.
        const { useCases } = makeUseCases({
            items: Array.from({ length: 9 }, (_, i) => ({ plu: i + 1, order_index: i, label_override: null })),
        });

        await expect(useCases.update(7, { grid_columns: 2, grid_rows: 2 }))
            .rejects.toThrow(/4 produtos/);
    });
});

describe('fundo', () => {
    it('recusa arquivo que não é imagem', async () => {
        const { useCases, repository } = makeUseCases();

        await expect(useCases.setBackground(7, { file_id: 10, mime_type: 'application/pdf' }))
            .rejects.toMatchObject({ statusCode: 400 });

        expect(repository.setBackground).not.toHaveBeenCalled();
    });

    it('aceita imagem', async () => {
        const { useCases, repository } = makeUseCases();

        await useCases.setBackground(7, { file_id: 10, mime_type: 'image/webp' });

        expect(repository.setBackground).toHaveBeenCalledWith(7, 10);
    });
});

describe('exclusão', () => {
    it('recusa quando a grade está em playlist — o CASCADE arrancaria o item', async () => {
        const { useCases, repository } = makeUseCases({ usage: 2 });

        await expect(useCases.remove(7)).rejects.toMatchObject({ statusCode: 409 });
        expect(repository.remove).not.toHaveBeenCalled();
    });

    it('apaga a MÍDIA, não a grade — é o CASCADE que leva o resto junto', async () => {
        const { useCases, repository } = makeUseCases({ usage: 0 });

        await useCases.remove(7);

        expect(repository.remove).toHaveBeenCalledWith(GRID_ROW.media_id);
    });
});

describe('render', () => {
    it('diz que NÃO renderizou — o renderizador ainda não existe', async () => {
        const { useCases, repository } = makeUseCases();

        const resultado = await useCases.requestRender(7);

        expect(repository.requestRender).toHaveBeenCalledWith(7);
        expect(resultado).toMatchObject({ requested: true, rendered: false });
    });
});

describe('resposta', () => {
    it('devolve stale como booleano, não o 0/1 do MySQL', async () => {
        const { useCases } = makeUseCases();

        const grade = await useCases.getById(7);

        expect(grade.stale).toBe(true);
        expect(grade.capacity).toBe(9);
        expect(grade.media).toMatchObject({ uuid: 'uuid-da-grade', status: 'processing' });
    });

    it('404 quando a grade não existe', async () => {
        const { useCases } = makeUseCases({ grid: null });

        await expect(useCases.getById(999)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('devolve o estilo efetivo mesmo para grade que nunca personalizou', async () => {
        // O editor do painel monta os campos a partir da resposta. Devolver
        // `null` obrigaria o front a conhecer os defaults do backend, e os dois
        // divergiriam no primeiro ajuste.
        const { useCases } = makeUseCases();

        const grade = await useCases.getById(7);

        expect(grade.style.card.opacity).toBe(92);
        expect(grade.style.price.color).toBe('#C0182B');
        expect(grade.style.position.order).toBe('label-first');
    });
});

describe('estilo do card', () => {
    const ESTILO_GRAVADO = {
        card: { background_color: '#101820', opacity: 80 },
        label: { font: 'dejavu-sans', size: 'G', color: '#FFFFFF', uppercase: false, max_lines: 2 },
        price: { font: 'liberation-sans', size: 'XG', color: '#FFD200' },
        position: { align: 'left', vertical: 'bottom', order: 'price-first' },
    };

    it('grava o estilo informado na criação', async () => {
        const { useCases, repository } = makeUseCases();

        await useCases.create(payload({
            style: { price: { color: '#FFD200', size: 'XG' } },
        }), ATOR);

        const gravado = repository.create.mock.calls[0][0].style;
        expect(gravado.price).toMatchObject({ color: '#FFD200', size: 'XG' });
        // O objeto vai completo para o banco: parcial geraria digital diferente
        // para a mesma aparência.
        expect(gravado.card.opacity).toBe(92);
    });

    it('recusa estilo inválido em vez de cair no padrão', async () => {
        // Cair no padrão faria o editor achar que gravou uma cor que não valeu,
        // e o CSS inválido seria descartado pelo Chromium sem erro nenhum.
        const { useCases, repository } = makeUseCases();

        await expect(useCases.create(payload({
            style: { price: { color: 'vermelho' } },
        }), ATOR)).rejects.toMatchObject({ statusCode: 400 });

        expect(repository.create).not.toHaveBeenCalled();
    });

    it('mescla o estilo no update, sem exigir o objeto inteiro', async () => {
        const { useCases, repository } = makeUseCases({
            grid: { ...GRID_ROW, style: ESTILO_GRAVADO },
        });

        await useCases.update(7, { style: { price: { size: 'XXG' } } });

        const gravado = repository.update.mock.calls[0][1].style;
        expect(gravado.price.size).toBe('XXG');
        // O que não veio no payload continua valendo.
        expect(gravado.price.color).toBe('#FFD200');
        expect(gravado.card.background_color).toBe('#101820');
    });

    it('update sem estilo preserva o que já estava gravado', async () => {
        const { useCases, repository } = makeUseCases({
            grid: { ...GRID_ROW, style: ESTILO_GRAVADO },
        });

        await useCases.update(7, { title: 'Outro título' });

        expect(repository.update.mock.calls[0][1].style).toEqual(ESTILO_GRAVADO);
    });
});
