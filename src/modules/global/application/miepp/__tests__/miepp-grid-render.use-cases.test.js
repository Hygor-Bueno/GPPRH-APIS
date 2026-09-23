/**
 * @fileoverview Testes do ciclo de render da grade.
 *
 * O que está protegido aqui é o que decide se um preço aparece na parede. Os
 * dois casos mais importantes são os que não geram imagem nenhuma:
 *
 *  - produto sem cadastro ativo → a grade INTEIRA sai do ar (decisão do
 *    requerente em 16/09/2026), e quem a tira é o status `error` da mídia;
 *  - falha de infraestrutura → `last_checked_at` NÃO é carimbado, senão a
 *    grade seguiria "em dia" com o preço de ontem enquanto o Oracle está fora.
 */

const { MieppGridRenderUseCases } = require('../product-grid/miepp-grid-render.use-cases');
const {
    resolveItems,
    computeDataHash,
    decideRender,
} = require('../../../domain/miepp/product-grid/grid-render.rules');

const GRID = {
    id: 1,
    media_id: 42,
    shop_id: 2,
    background_file_id: 2259,
    grid_columns: 3,
    grid_rows: 3,
    data_hash: null,
    title: 'Seca salgada',
    media_status: 'processing',
};

const ITENS = [
    { plu: 100, order_index: 0, label_override: null },
    { plu: 200, order_index: 1, label_override: 'Oferta da semana' },
];

/** Linha como o Oracle devolve. */
function linha(plu, { desc = `PRODUTO ${plu}`, price = 10, promo = 0 } = {}) {
    return { PLU: plu, DESCRIPTION: desc, BARCODE: '789', PRICE: price, PRICE_PROMOTION: promo };
}

function makeUseCases({ rows = [linha(100), linha(200)], grids = [GRID], items = ITENS } = {}) {
    const repository = {
        listToRender: jest.fn(async () => grids),
        findItems: jest.fn(async () => items),
        markChecked: jest.fn(async () => {}),
        markOffAir: jest.fn(async () => {}),
        markFailed: jest.fn(async () => {}),
        markRendered: jest.fn(async () => {}),
        setMediaFile: jest.fn(async () => {}),
        setMediaStatus: jest.fn(async () => {}),
        insertRender: jest.fn(async () => {}),
    };

    const productSource = {
        findActiveProductsByPlus: jest.fn(async () => rows),
    };

    const renderer = {
        render: jest.fn(async () => Buffer.from('png-falso')),
        open: jest.fn(async () => {}),
        close: jest.fn(async () => {}),
    };

    const storage = {
        save: jest.fn(async () => ({
            file_id: 999, mime_type: 'image/webp', size_bytes: 1234, checksum: 'a'.repeat(64),
        })),
        resolve: jest.fn(async () => ({ absolutePath: '/tmp/fundo.webp', mimeType: 'image/webp' })),
    };

    return {
        repository, productSource, renderer, storage,
        useCases: new MieppGridRenderUseCases({ repository, productSource, renderer, storage }),
    };
}

beforeEach(() => jest.clearAllMocks());

describe('produto sem cadastro ativo tira a grade inteira do ar', () => {
    it('marca off_air e põe a mídia em error — é o error que some da playlist', async () => {
        const { useCases, repository } = makeUseCases({ rows: [linha(100)] }); // falta o 200

        const resultado = await useCases.renderGrid(GRID);

        expect(resultado).toBe('off_air');
        expect(repository.setMediaStatus).toHaveBeenCalledWith(42, 'error');
        expect(repository.markOffAir).toHaveBeenCalledWith(1, expect.stringContaining('200'));
    });

    it('não renderiza imagem nenhuma — nada de vitrine com buraco', async () => {
        const { useCases, renderer, repository } = makeUseCases({ rows: [linha(100)] });

        await useCases.renderGrid(GRID);

        expect(renderer.render).not.toHaveBeenCalled();
        expect(repository.markRendered).not.toHaveBeenCalled();
    });

    it('grade sem itens também sai do ar', async () => {
        const { useCases, repository } = makeUseCases({ items: [], rows: [] });

        expect(await useCases.renderGrid(GRID)).toBe('off_air');
        expect(repository.setMediaStatus).toHaveBeenCalledWith(42, 'error');
    });
});

describe('falha de infraestrutura', () => {
    it('NÃO carimba last_checked_at — a grade precisa envelhecer e sair sozinha', async () => {
        const { useCases, repository, productSource } = makeUseCases();
        productSource.findActiveProductsByPlus.mockRejectedValueOnce(new Error('ORA-12541'));

        expect(await useCases.renderGrid(GRID)).toBe('failed');

        expect(repository.markFailed).toHaveBeenCalledWith(1, 'ORA-12541');
        expect(repository.markChecked).not.toHaveBeenCalled();
        expect(repository.markOffAir).not.toHaveBeenCalled();
        // Deixar a mídia intacta é deliberado: o conteúdo antigo continua
        // válido até vencer por tempo.
        expect(repository.setMediaStatus).not.toHaveBeenCalled();
    });

    it('uma grade quebrada não interrompe o lote', async () => {
        const { useCases, repository, productSource } = makeUseCases({
            grids: [{ ...GRID, id: 1 }, { ...GRID, id: 2 }, { ...GRID, id: 3 }],
        });
        productSource.findActiveProductsByPlus
            .mockRejectedValueOnce(new Error('falhou a primeira'));

        const tally = await useCases.runCycle();

        expect(tally).toEqual({ rendered: 2, unchanged: 0, off_air: 0, failed: 1 });
        expect(repository.listToRender).toHaveBeenCalled();
    });
});

describe('conteúdo inalterado', () => {
    it('não renderiza de novo — senão as telas rebaixam a mesma imagem toda hora', async () => {
        const { useCases, renderer, repository, storage } = makeUseCases();

        // Roda uma vez para descobrir o hash e devolve a grade já com ele.
        const { resolved } = resolveItems(ITENS, [linha(100), linha(200)]);
        const hash = computeDataHash(GRID, resolved);

        const resultado = await useCases.renderGrid({ ...GRID, data_hash: hash });

        expect(resultado).toBe('unchanged');
        expect(renderer.render).not.toHaveBeenCalled();
        expect(storage.save).not.toHaveBeenCalled();
        expect(repository.markChecked).toHaveBeenCalledWith(1);
    });
});

describe('render efetivo', () => {
    it('grava o arquivo ANTES de apontar a mídia para ele', async () => {
        const { useCases, repository, storage } = makeUseCases();

        await useCases.renderGrid(GRID);

        const ordemSave = storage.save.mock.invocationCallOrder[0];
        const ordemAponta = repository.setMediaFile.mock.invocationCallOrder[0];
        expect(ordemSave).toBeLessThan(ordemAponta);
    });

    it('publica a mídia e grava a trilha com o preço exibido', async () => {
        const { useCases, repository } = makeUseCases({
            rows: [linha(100, { price: 10 }), linha(200, { price: 8.5, promo: 6.99 })],
        });

        await useCases.renderGrid(GRID);

        expect(repository.setMediaFile).toHaveBeenCalledWith(42, expect.objectContaining({ file_id: 999 }));
        expect(repository.markRendered).toHaveBeenCalledWith(1, expect.any(String));

        const trilha = repository.insertRender.mock.calls[0][0];
        expect(trilha.snapshot.items[1]).toMatchObject({ plu: 200, exibido: 'R$ 6,99' });
    });

    it('a trilha guarda também o layout e o estilo do render', async () => {
        // Sem isto, dois renders com os mesmos produtos e imagens diferentes
        // ficam inexplicáveis — foi o que aconteceu em 18/09/2026, quando a
        // diferença era o número de colunas e a trilha não a registrava.
        const { useCases, repository } = makeUseCases();

        await useCases.renderGrid({ ...GRID, style: { price: { color: '#FFD200' } } });

        const { snapshot } = repository.insertRender.mock.calls[0][0];

        expect(snapshot.layout).toEqual({
            grid_columns: 3,
            grid_rows: 3,
            background_file_id: 2259,
        });
        expect(snapshot.style.price.color).toBe('#FFD200');
        // O estilo vai completo, não só o que o usuário mexeu: a trilha
        // precisa descrever a imagem sozinha, sem consultar o padrão da versão
        // do código que estava no ar naquele dia.
        expect(snapshot.style.card.opacity).toBe(92);
    });

    it('leva o estilo da grade até o renderizador', async () => {
        const { useCases, renderer } = makeUseCases();

        await useCases.renderGrid({ ...GRID, style: { position: { order: 'price-first' } } });

        expect(renderer.render).toHaveBeenCalledWith(
            expect.objectContaining({
                style: expect.objectContaining({
                    position: expect.objectContaining({ order: 'price-first' }),
                }),
            })
        );
    });

    it('fecha o Chromium mesmo quando o lote estoura', async () => {
        const { useCases, renderer } = makeUseCases();
        renderer.render.mockRejectedValue(new Error('chromium morreu'));

        await useCases.runCycle();

        expect(renderer.close).toHaveBeenCalled();
    });
});

describe('regras puras', () => {
    it('label_override vence a descrição do Consinco', () => {
        const { resolved } = resolveItems(ITENS, [linha(100), linha(200)]);
        expect(resolved[0].label).toBe('PRODUTO 100');
        expect(resolved[1].label).toBe('Oferta da semana');
    });

    it('o hash muda quando o preço muda', () => {
        const antes = resolveItems(ITENS, [linha(100, { price: 10 }), linha(200)]);
        const depois = resolveItems(ITENS, [linha(100, { price: 11 }), linha(200)]);

        expect(computeDataHash(GRID, antes.resolved))
            .not.toBe(computeDataHash(GRID, depois.resolved));
    });

    it('o hash muda quando o fundo muda', () => {
        const { resolved } = resolveItems(ITENS, [linha(100), linha(200)]);

        expect(computeDataHash(GRID, resolved))
            .not.toBe(computeDataHash({ ...GRID, background_file_id: 7 }, resolved));
    });

    it('o hash NÃO muda por carimbo de tempo — senão renderizaria sempre', () => {
        const { resolved } = resolveItems(ITENS, [linha(100), linha(200)]);

        expect(computeDataHash({ ...GRID, updated_at: 'agora' }, resolved))
            .toBe(computeDataHash({ ...GRID, updated_at: 'outra hora' }, resolved));
    });

    it('decideRender prefere off_air a unchanged quando falta produto', () => {
        // Mesmo com o hash batendo, produto morto ganha: exibir é pior que
        // sumir.
        const resolucao = { resolved: [], missing: [200] };
        expect(decideRender({ ...GRID, data_hash: 'x' }, resolucao, 'x').action).toBe('off_air');
    });
});
