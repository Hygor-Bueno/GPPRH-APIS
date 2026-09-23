/**
 * @fileoverview Testes do HTML da grade.
 *
 * O template não é testado por gosto de HTML: ele é o último ponto antes do
 * Chromium, e erro aqui vira imagem errada na parede de uma loja — sem exceção,
 * sem log e sem ninguém saber, porque CSS inválido é descartado em silêncio.
 *
 * O caso mais importante é o primeiro: o estilo padrão precisa continuar
 * gerando o CSS que o módulo gerava antes de a personalização existir.
 */

const { renderGridHtml } = require('../grid.template');

const ITENS = [
    {
        plu: 5617,
        order_index: 0,
        label: 'REFRI COCA COLA 1,5L',
        price: 9.9,
        price_promotion: null,
        promotion: false,
    },
    {
        plu: 72641,
        order_index: 1,
        label: 'BARRA PROT 3 CORACOES 50G',
        price: 12.99,
        price_promotion: 9.99,
        promotion: true,
    },
];

/** 1080p, 3x3 — a mesma forma usada nos testes do ciclo de render. */
function render(style) {
    return renderGridHtml({
        columns: 3,
        rows: 3,
        width: 1920,
        height: 1080,
        backgroundDataUri: null,
        items: ITENS,
        style,
    });
}

describe('estilo padrão', () => {
    it('reproduz o CSS de antes da personalização', () => {
        const html = render();

        // Valores que estavam fixos no arquivo. Mudar qualquer um faz TODA
        // grade no ar renderizar diferente no primeiro ciclo após o deploy.
        expect(html).toContain('background: rgba(255, 255, 255, 0.92)');
        expect(html).toContain('color: #10243F');
        expect(html).toContain('color: #C0182B');
        expect(html).toContain('text-transform: uppercase;');
        expect(html).toContain('-webkit-line-clamp: 3;');
        expect(html).toContain('align-items: center');
        expect(html).toContain('justify-content: center');
    });

    it('mantém o tamanho calculado pela densidade quando o degrau é M', () => {
        const html = render();

        // 1080 / (3 * 3.2) = 112 ; 1080 / (3 * 8) = 45. São os mesmos números
        // que o template produzia antes de existir multiplicador.
        expect(html).toContain('font-size: 112px');
        expect(html).toContain('font-size: 45px');
    });

    it('não referencia nada da rede', () => {
        // Fonte ou CSS externo faria a imagem mudar quando a internet oscila, e
        // o `data_hash` deixaria de descrever o que foi para a parede.
        const html = render();

        expect(html).not.toMatch(/https?:\/\//);
        expect(html).not.toContain('@import');
    });
});

describe('estilo personalizado', () => {
    it('aplica cor e opacidade do card', () => {
        const html = render({ card: { background_color: '#101820', opacity: 60 } });

        expect(html).toContain('background: rgba(16, 24, 32, 0.60)');
    });

    it('aplica cor da descrição e do preço', () => {
        const html = render({
            label: { color: '#FFFFFF' },
            price: { color: '#FFD200' },
        });

        expect(html).toContain('color: #FFFFFF');
        expect(html).toContain('color: #FFD200');
    });

    it('o degrau de tamanho multiplica o valor calculado, não o substitui', () => {
        const html = render({ price: { size: 'XG' }, label: { size: 'PP' } });

        // 113 * 1,5 = 168,75 → 169 ; 45 * 0,65 = 29,25 → 29
        expect(html).toContain('font-size: 169px');
        expect(html).toContain('font-size: 29px');
    });

    it('troca a família da fonte pela pilha correspondente', () => {
        const html = render({ price: { font: 'dejavu-mono' } });

        expect(html).toContain('"DejaVu Sans Mono", "Liberation Mono", monospace');
    });

    it('desliga a caixa alta quando pedido', () => {
        expect(render({ label: { uppercase: false } })).not.toContain('text-transform: uppercase;');
    });

    it('aplica alinhamento e posição vertical', () => {
        const html = render({ position: { align: 'left', vertical: 'bottom' } });

        expect(html).toContain('align-items: flex-start');
        expect(html).toContain('justify-content: flex-end');
        expect(html).toContain('text-align: left');
    });

    it('inverte a ordem sem mexer no DOM', () => {
        const html = render({ position: { order: 'price-first' } });

        // O HTML mantém a descrição primeiro — quem inverte é o `order` do
        // flex. Assim o HTML continua legível para quem depura um render.
        expect(html.indexOf('class="label"')).toBeLessThan(html.indexOf('class="price"'));
        expect(html).toContain('order: 1;');
        expect(html).toContain('order: 3;');
    });

    it('o respiro muda de elemento quando o preço vai para cima', () => {
        // Com `gap` no flex o preço riscado também seria afastado, mudando a
        // imagem de toda grade em promoção que já está no ar.
        const padrao = render();
        const invertido = render({ position: { order: 'price-first' } });

        // 45 / 2 = 22,5 → 23
        expect(padrao).toMatch(/\.price \{[^}]*margin-top: 23px;/s);
        expect(invertido).toMatch(/\.label \{[^}]*margin-top: 23px;/s);
    });
});

describe('conteúdo', () => {
    it('mostra o preço promocional e o normal riscado', () => {
        const html = render();

        expect(html).toContain('9,99');
        expect(html).toContain('de R$ 12,99');
        expect(html).toContain('class="was"');
    });

    it('escapa a descrição que vem do ERP', () => {
        const html = renderGridHtml({
            columns: 1,
            rows: 1,
            width: 1920,
            height: 1080,
            backgroundDataUri: null,
            items: [{ plu: 1, order_index: 0, label: 'CAFE <B> & CIA "500G"', price: 1, price_promotion: null, promotion: false }],
        });

        expect(html).toContain('CAFE &lt;B&gt; &amp; CIA &quot;500G&quot;');
        expect(html).not.toContain('<B>');
    });
});
