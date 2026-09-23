/**
 * @fileoverview HTML da grade de produtos, renderizado para imagem.
 *
 * Puro: recebe os itens já resolvidos e devolve string. Segue a convenção do
 * `templates/receipt/receipt.template.js`.
 *
 * Três decisões que não são estéticas:
 *
 *  - **O fundo entra como data URI**, não como caminho de arquivo. O Chromium
 *    roda com `--no-sandbox` e sem servidor de arquivos; um `file://` daria
 *    certo em desenvolvimento e falharia calado no container, produzindo uma
 *    grade com fundo branco que ninguém liga ao deploy.
 *  - **Nada é carregado da rede.** Sem fonte do Google, sem CSS externo. Uma
 *    grade que depende de rede no momento do render é uma grade que sai
 *    diferente quando a internet oscila, e o `data_hash` deixaria de descrever
 *    a imagem.
 *  - **O estilo chega validado.** Cor, fonte e tamanho são interpolados direto
 *    no CSS, e não existe escape para valor de CSS — quem garante que são
 *    seguros é `grid-style.rules`, e este arquivo não revalida nada.
 *
 * As fontes são as que a imagem tem (`fonts-liberation`, `fonts-dejavu-core`,
 * instaladas no `Dockerfile.internal`). Trocar a imagem base sem elas faz o
 * texto cair num fallback qualquer — e o preço na parede muda de cara sem que
 * nada no log diga o porquê.
 *
 * @module templates/miepp-grid/grid.template
 */

const { formatPrice } = require('../../modules/global/domain/miepp/product-grid/grid-render.rules');
const {
    FONT_FAMILIES,
    SIZE_STEPS,
    hexToRgbChannels,
    normalizeStyle,
} = require('../../modules/global/domain/miepp/product-grid/grid-style.rules');

/** Escapa para inserção segura em HTML. Descrição do ERP já veio com `&` e `<`. */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Alinhamento do estilo → valor de `align-items`/`justify-content` do flex. */
const FLEX_ALIGNMENT = Object.freeze({
    left: 'flex-start',
    center: 'center',
    right: 'flex-end',
    top: 'flex-start',
    bottom: 'flex-end',
});

/**
 * Card de um produto.
 *
 * Em promoção, o preço normal aparece riscado ao lado do promocional — é o que
 * a legislação de oferta espera e o que o cliente confere no caixa.
 *
 * A ordem visual é resolvida no CSS (`order`), não aqui: manter o DOM estável
 * deixa a descrição sempre primeiro para quem for ler o HTML depurando um
 * render.
 */
function productCard(item) {
    const hasPromotion = item.promotion && item.price_promotion !== null;
    const mainPrice = hasPromotion ? item.price_promotion : item.price;

    return `
    <li class="card">
        <span class="label">${escapeHtml(item.label)}</span>
        <span class="price">
            <em>R$</em>${escapeHtml(formatPrice(mainPrice))}
        </span>
        ${hasPromotion ? `<span class="was">de R$ ${escapeHtml(formatPrice(item.price))}</span>` : ''}
    </li>`;
}

/**
 * Monta o HTML completo da grade.
 *
 * @param {object} params
 * @param {number} params.columns
 * @param {number} params.rows
 * @param {number} params.width  - px da imagem final.
 * @param {number} params.height
 * @param {string|null} params.backgroundDataUri - `data:image/...;base64,...`.
 * @param {object[]} params.items - saída de `resolveItems`.
 * @param {object} [params.style] - estilo da grade; ausente usa o padrão.
 * @returns {string}
 */
function renderGridHtml({ columns, rows, width, height, backgroundDataUri, items, style }) {
    // `normalizeStyle` devolve o objeto inteiro: daqui para baixo nenhum campo
    // é opcional, e não há `??` espalhado pelo CSS.
    const theme = normalizeStyle(style);

    // O tamanho da fonte acompanha o número de células: 2x2 numa tela de 1080p
    // comporta um preço enorme, 6x6 não. Sem isto, a grade densa sai com texto
    // transbordando do card — e transbordo em preço é ilegível, não feio.
    //
    // O degrau escolhido no painel MULTIPLICA este valor em vez de substituí-lo,
    // justamente para não perder essa proteção. `M` vale 1, então o estilo
    // padrão reproduz exatamente a imagem de antes desta feature.
    const densidade = Math.max(columns, rows);
    const priceSize = Math.round((height / (densidade * 3.2)) * SIZE_STEPS[theme.price.size]);
    const labelSize = Math.round((height / (densidade * 8)) * SIZE_STEPS[theme.label.size]);

    const [cardR, cardG, cardB] = hexToRgbChannels(theme.card.background_color);
    const cardAlpha = (theme.card.opacity / 100).toFixed(2);

    const priceFirst = theme.position.order === 'price-first';

    // O respiro fica sempre no elemento de baixo. Usar `gap` no flex seria mais
    // curto, mas afastaria também o preço riscado, mudando a imagem de toda
    // grade em promoção que já está no ar.
    const spacing = Math.round(labelSize / 2);

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    html, body {
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        font-family: ${FONT_FAMILIES[theme.label.font]};
    }

    body {
        background-color: #10243f;
        ${backgroundDataUri ? `background-image: url("${backgroundDataUri}");` : ''}
        background-size: cover;
        background-position: center;
    }

    ul.grade {
        list-style: none;
        display: grid;
        grid-template-columns: repeat(${columns}, 1fr);
        grid-template-rows: repeat(${rows}, 1fr);
        gap: ${Math.round(height / 60)}px;
        padding: ${Math.round(height / 40)}px;
        width: 100%;
        height: 100%;
    }

    .card {
        display: flex;
        flex-direction: column;
        align-items: ${FLEX_ALIGNMENT[theme.position.align]};
        justify-content: ${FLEX_ALIGNMENT[theme.position.vertical]};
        text-align: ${theme.position.align};
        /* Fundo semitransparente: o fundo enviado pode ser claro ou escuro, e
           o preço precisa continuar legível nos dois. */
        background: rgba(${cardR}, ${cardG}, ${cardB}, ${cardAlpha});
        border-radius: ${Math.round(height / 90)}px;
        padding: ${Math.round(height / 90)}px;
        overflow: hidden;
    }

    .label {
        order: ${priceFirst ? 3 : 1};
        font-family: ${FONT_FAMILIES[theme.label.font]};
        font-size: ${labelSize}px;
        line-height: 1.15;
        color: ${theme.label.color};
        ${theme.label.uppercase ? 'text-transform: uppercase;' : ''}
        ${priceFirst ? `margin-top: ${spacing}px;` : ''}
        /* Descrição do Consinco chega longa; corta na linha escolhida. */
        display: -webkit-box;
        -webkit-line-clamp: ${theme.label.max_lines};
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .price {
        order: ${priceFirst ? 1 : 2};
        font-family: ${FONT_FAMILIES[theme.price.font]};
        font-size: ${priceSize}px;
        font-weight: bold;
        line-height: 1;
        color: ${theme.price.color};
        ${priceFirst ? '' : `margin-top: ${spacing}px;`}
        white-space: nowrap;
    }

    .price em {
        font-size: ${Math.round(priceSize * 0.45)}px;
        font-style: normal;
        vertical-align: super;
        margin-right: ${Math.round(priceSize * 0.08)}px;
    }

    .was {
        order: ${priceFirst ? 2 : 3};
        font-size: ${Math.round(labelSize * 0.9)}px;
        color: #555;
        text-decoration: line-through;
    }
</style>
</head>
<body>
<ul class="grade">
${items.map(productCard).join('')}
</ul>
</body>
</html>`;
}

module.exports = { renderGridHtml, escapeHtml };
