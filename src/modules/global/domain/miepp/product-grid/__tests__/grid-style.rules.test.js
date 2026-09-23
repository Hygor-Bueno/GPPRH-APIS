/**
 * @fileoverview Testes do estilo visual da grade.
 *
 * Três coisas são protegidas aqui, e as três já custaram caro neste módulo:
 *
 *  - **O padrão não pode mudar.** Ele reproduz a imagem que o módulo gerava
 *    antes desta feature. Mexer nele faz toda grade já no ar renderizar
 *    diferente no primeiro ciclo depois do deploy, sem ninguém ter pedido.
 *  - **Valor inválido tem que ser recusado, não corrigido.** Cor e fonte são
 *    interpoladas direto no CSS; um valor torto vira regra que o Chromium
 *    descarta em silêncio, e a grade sai com a aparência antiga sem erro nenhum
 *    no log.
 *  - **A digital tem que enxergar o estilo.** Se ela não enxergar, mudar a cor
 *    no painel não dispara render — o mesmo sintoma que levou uma investigação
 *    inteira em 18/09/2026, quando a digital ainda não via o layout.
 */

const {
    DEFAULT_STYLE,
    FONT_FAMILIES,
    SIZE_STEPS,
    findStyleError,
    normalizeStyle,
    styleFingerprint,
    hexToRgbChannels,
} = require('../grid-style.rules');

const { computeDataHash } = require('../grid-render.rules');

describe('normalizeStyle', () => {
    it('sem estilo devolve o padrão completo', () => {
        expect(normalizeStyle()).toEqual(DEFAULT_STYLE);
        expect(normalizeStyle(null)).toEqual(DEFAULT_STYLE);
    });

    it('o padrão reproduz a aparência anterior à feature', () => {
        // Estes valores estavam fixos no template. Se este teste quebrar, toda
        // grade no ar vai mudar de cara no próximo ciclo.
        expect(DEFAULT_STYLE.card.background_color).toBe('#FFFFFF');
        expect(DEFAULT_STYLE.card.opacity).toBe(92);
        expect(DEFAULT_STYLE.label.color).toBe('#10243F');
        expect(DEFAULT_STYLE.price.color).toBe('#C0182B');
        expect(DEFAULT_STYLE.label.uppercase).toBe(true);
        expect(DEFAULT_STYLE.label.max_lines).toBe(3);
        // `M` precisa valer exatamente 1: é o multiplicador que mantém o
        // tamanho calculado pela densidade intacto.
        expect(SIZE_STEPS[DEFAULT_STYLE.label.size]).toBe(1);
        expect(SIZE_STEPS[DEFAULT_STYLE.price.size]).toBe(1);
    });

    it('devolve o objeto inteiro mesmo recebendo um campo só', () => {
        const style = normalizeStyle({ price: { size: 'XG' } });

        expect(style.price.size).toBe('XG');
        // O resto vem do padrão — objeto parcial geraria digital diferente para
        // a mesma aparência.
        expect(style.label).toEqual(DEFAULT_STYLE.label);
        expect(style.card).toEqual(DEFAULT_STYLE.card);
        expect(style.position).toEqual(DEFAULT_STYLE.position);
    });

    it('mescla sobre o estilo atual, que é o PUT parcial do painel', () => {
        const current = normalizeStyle({
            card: { background_color: '#101820', opacity: 80 },
            price: { color: '#FFD200' },
        });

        const style = normalizeStyle({ price: { size: 'G' } }, current);

        expect(style.price.size).toBe('G');
        // O que não veio no payload continua sendo o que já estava gravado.
        expect(style.price.color).toBe('#FFD200');
        expect(style.card.background_color).toBe('#101820');
        expect(style.card.opacity).toBe(80);
    });

    it('normaliza a caixa de cor e tamanho', () => {
        const style = normalizeStyle({
            card: { background_color: '#aabbcc' },
            price: { size: 'xg' },
        });

        // Duas grafias da mesma cor gerariam duas digitais, e a grade
        // renderizaria de novo sem nada ter mudado.
        expect(style.card.background_color).toBe('#AABBCC');
        expect(style.price.size).toBe('XG');
    });
});

describe('findStyleError', () => {
    it('aceita ausência de estilo', () => {
        expect(findStyleError(undefined)).toBeNull();
        expect(findStyleError(null)).toBeNull();
    });

    it('aceita um estilo completo e válido', () => {
        expect(findStyleError({
            card: { background_color: '#101820', opacity: 85 },
            label: { font: 'dejavu-sans', size: 'G', color: '#FFFFFF', uppercase: false, max_lines: 2 },
            price: { font: 'liberation-sans', size: 'XG', color: '#FFD200' },
            position: { align: 'left', vertical: 'bottom', order: 'price-first' },
        })).toBeNull();
    });

    it('recusa cor que não é hexadecimal de 6 dígitos', () => {
        expect(findStyleError({ price: { color: 'red' } })).toMatch(/hexadecimal/);
        // Forma curta é recusada: duas grafias da mesma cor, duas digitais.
        expect(findStyleError({ price: { color: '#fff' } })).toMatch(/hexadecimal/);
    });

    it('recusa cor que tentaria escapar do seletor CSS', () => {
        // Não existe escape para valor de CSS — a recusa aqui é a única defesa.
        const problem = findStyleError({ label: { color: 'red; } body { display: none' } });
        expect(problem).toMatch(/hexadecimal/);
    });

    it('recusa fonte fora das instaladas na imagem', () => {
        const problem = findStyleError({ label: { font: 'comic-sans' } });
        expect(problem).toMatch(/Fonte desconhecida/);
        // A mensagem lista o que vale, porque quem recebe é quem está editando.
        for (const family of Object.keys(FONT_FAMILIES)) {
            expect(problem).toContain(family);
        }
    });

    it('recusa degrau de tamanho inexistente', () => {
        expect(findStyleError({ price: { size: 'GG' } })).toMatch(/Tamanho desconhecido/);
    });

    it('recusa opacidade fora da faixa legível', () => {
        expect(findStyleError({ card: { opacity: 5 } })).toMatch(/entre 10 e 100/);
        expect(findStyleError({ card: { opacity: 120 } })).toMatch(/entre 10 e 100/);
        expect(findStyleError({ card: { opacity: 10 } })).toBeNull();
    });

    it('recusa número de linhas fora da faixa', () => {
        expect(findStyleError({ label: { max_lines: 0 } })).toMatch(/entre 1 e 4/);
        expect(findStyleError({ label: { max_lines: 9 } })).toMatch(/entre 1 e 4/);
    });

    it('recusa posição desconhecida', () => {
        expect(findStyleError({ position: { align: 'justify' } })).toMatch(/Alinhamento desconhecido/);
        expect(findStyleError({ position: { vertical: 'middle' } })).toMatch(/Posição vertical/);
        expect(findStyleError({ position: { order: 'random' } })).toMatch(/Ordem desconhecida/);
    });

    it('recusa campo e seção que não existem, em vez de ignorar', () => {
        // Ignorar faria o editor acreditar que gravou algo que não gravou.
        expect(findStyleError({ fundo: {} })).toMatch(/Seção de estilo desconhecida/);
        expect(findStyleError({ card: { sombra: true } })).toMatch(/Campo de estilo desconhecido/);
    });

    it('recusa tipo errado no lugar de objeto', () => {
        expect(findStyleError('escuro')).toMatch(/precisa ser um objeto/);
        expect(findStyleError([])).toMatch(/precisa ser um objeto/);
        expect(findStyleError({ card: 'branco' })).toMatch(/precisa ser um objeto/);
    });

    it('recusa booleano escrito como texto', () => {
        expect(findStyleError({ label: { uppercase: 'sim' } })).toMatch(/verdadeiro ou falso/);
    });
});

describe('hexToRgbChannels', () => {
    it('separa os três canais', () => {
        expect(hexToRgbChannels('#1A2B3C')).toEqual([26, 43, 60]);
        expect(hexToRgbChannels('#FFFFFF')).toEqual([255, 255, 255]);
        expect(hexToRgbChannels('#000000')).toEqual([0, 0, 0]);
    });
});

describe('styleFingerprint dentro do data_hash', () => {
    const GRID = {
        grid_columns: 3,
        grid_rows: 3,
        background_file_id: 2259,
        style: null,
    };

    const RESOLVED = [
        { order_index: 0, plu: 5617, label: 'REFRI COCA COLA 1,5L', price: 9.9, price_promotion: null },
    ];

    it('grade sem estilo tem a mesma digital do estilo padrão', () => {
        // Senão toda grade antiga renderizaria só porque a coluna está nula.
        const semEstilo = computeDataHash({ ...GRID, style: null }, RESOLVED);
        const comPadrao = computeDataHash({ ...GRID, style: DEFAULT_STYLE }, RESOLVED);

        expect(semEstilo).toBe(comPadrao);
    });

    it('mudar a cor do preço muda a digital', () => {
        // Este é O teste da feature: sem ele, mudar a cor no painel não
        // dispararia render nenhum e nada explicaria o porquê.
        const antes = computeDataHash(GRID, RESOLVED);
        const depois = computeDataHash(
            { ...GRID, style: { price: { color: '#FFD200' } } },
            RESOLVED
        );

        expect(depois).not.toBe(antes);
    });

    it('cada campo do estilo mexe na digital', () => {
        const base = computeDataHash(GRID, RESOLVED);

        const variacoes = [
            { card: { background_color: '#101820' } },
            { card: { opacity: 70 } },
            { label: { font: 'dejavu-serif' } },
            { label: { size: 'G' } },
            { label: { color: '#FFFFFF' } },
            { label: { uppercase: false } },
            { label: { max_lines: 2 } },
            { price: { font: 'dejavu-mono' } },
            { price: { size: 'XXG' } },
            { price: { color: '#00FF00' } },
            { position: { align: 'left' } },
            { position: { vertical: 'top' } },
            { position: { order: 'price-first' } },
        ];

        for (const style of variacoes) {
            expect(computeDataHash({ ...GRID, style }, RESOLVED)).not.toBe(base);
        }
    });

    it('a mesma aparência gera sempre a mesma digital', () => {
        // Ordem de chave diferente no JSON não pode virar digital diferente,
        // senão a grade renderiza sozinha a cada salvamento.
        const umaOrdem = { price: { color: '#FFD200', size: 'G' }, card: { opacity: 70 } };
        const outraOrdem = { card: { opacity: 70 }, price: { size: 'G', color: '#FFD200' } };

        expect(computeDataHash({ ...GRID, style: umaOrdem }, RESOLVED))
            .toBe(computeDataHash({ ...GRID, style: outraOrdem }, RESOLVED));
    });

    it('a digital do estilo tem um valor por campo configurável', () => {
        // Guarda contra o esquecimento clássico: campo novo no estilo que não
        // entra na digital não dispara render, e falha em silêncio.
        expect(styleFingerprint(DEFAULT_STYLE)).toHaveLength(13);
    });
});
