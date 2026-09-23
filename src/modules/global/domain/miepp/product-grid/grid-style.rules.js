/**
 * @fileoverview Estilo visual do card de produto — vocabulário fechado e puro.
 *
 * ─── Por que nada aqui é livre ───────────────────────────────────────────────
 *
 * Todo valor deste módulo é interpolado DIRETO no CSS do template. Diferente da
 * descrição do produto, que passa por `escapeHtml`, não existe escape para
 * valor de CSS: uma cor com `red; } body { display: none` sairia do seletor e
 * quebraria a imagem inteira — e quebraria calado, porque o Chromium ignora
 * regra inválida sem reclamar. Por isso cor é regex de hexadecimal, fonte e
 * tamanho são chave de mapa, e número tem piso e teto. O que não casa é
 * recusado na borda, não corrigido em silêncio.
 *
 * ─── Por que tamanho é degrau, e não pixel ───────────────────────────────────
 *
 * O template calcula a fonte a partir da densidade da grade: 1x6 comporta um
 * preço enorme, 6x6 não. Um valor absoluto em pixel ficaria bom numa grade e
 * transbordaria na outra — e preço transbordado não é feio, é ilegível. Os
 * degraus são multiplicadores sobre o tamanho calculado: o usuário escolhe a
 * proporção e o ajuste automático continua protegendo o limite do card.
 *
 * ─── Por que a fonte vem de uma lista ────────────────────────────────────────
 *
 * O render não carrega nada da rede (ver o cabeçalho do template). Só valem as
 * famílias instaladas na imagem — `fonts-liberation` e `fonts-dejavu-core`, no
 * `Dockerfile.internal`. Acrescentar família aqui sem acrescentar o pacote lá
 * faz o texto cair num fallback qualquer, e o preço muda de cara na parede sem
 * que nada no log diga por quê.
 *
 * @module modules/global/domain/miepp/product-grid/grid-style.rules
 */

/**
 * Famílias disponíveis → pilha CSS.
 *
 * O segundo nome de cada pilha é seguro de propósito: se o pacote sumir da
 * imagem, o texto cai numa fonte instalada em vez de cair no `sans-serif`
 * genérico do Chromium, que muda de máquina para máquina.
 */
const FONT_FAMILIES = Object.freeze({
    'liberation-sans':  '"Liberation Sans", "DejaVu Sans", sans-serif',
    'liberation-serif': '"Liberation Serif", "DejaVu Serif", serif',
    'liberation-mono':  '"Liberation Mono", "DejaVu Sans Mono", monospace',
    'dejavu-sans':      '"DejaVu Sans", "Liberation Sans", sans-serif',
    'dejavu-serif':     '"DejaVu Serif", "Liberation Serif", serif',
    'dejavu-mono':      '"DejaVu Sans Mono", "Liberation Mono", monospace',
});

/**
 * Degraus de tamanho → multiplicador sobre o tamanho calculado pela densidade.
 *
 * `M` é exatamente 1: é o que faz o estilo padrão reproduzir, pixel a pixel, a
 * imagem que o módulo já gerava antes deste arquivo existir.
 */
const SIZE_STEPS = Object.freeze({
    PP:  0.65,
    P:   0.82,
    M:   1,
    G:   1.22,
    XG:  1.5,
    XXG: 1.85,
});

/** Alinhamento horizontal do conteúdo do card. */
const ALIGNMENTS = Object.freeze(['left', 'center', 'right']);

/** Posição do bloco de texto dentro do card. */
const VERTICAL_ALIGNMENTS = Object.freeze(['top', 'center', 'bottom']);

/** Quem aparece em cima. */
const CONTENT_ORDERS = Object.freeze(['label-first', 'price-first']);

/**
 * Cor em hexadecimal de 6 dígitos.
 *
 * Forma curta (`#fff`) é recusada de propósito: aceitar duas grafias faria a
 * mesma cor gerar dois `data_hash` diferentes, e a grade re-renderizaria sem
 * que nada tivesse mudado de fato.
 */
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Opacidade do card, em porcentagem. Abaixo de 10 o texto some no fundo. */
const MIN_OPACITY = 10;
const MAX_OPACITY = 100;

/** Linhas da descrição antes de cortar. Acima de 4 não sobra espaço para o preço. */
const MIN_LABEL_LINES = 1;
const MAX_LABEL_LINES = 4;

/**
 * O estilo de quem nunca escolheu estilo.
 *
 * Estes valores são os que estavam fixos no template antes desta feature — e
 * precisam continuar sendo, senão toda grade já criada renderiza diferente no
 * primeiro ciclo depois do deploy.
 */
const DEFAULT_STYLE = Object.freeze({
    card: Object.freeze({
        background_color: '#FFFFFF',
        opacity: 92,
    }),
    label: Object.freeze({
        font: 'liberation-sans',
        size: 'M',
        color: '#10243F',
        uppercase: true,
        max_lines: 3,
    }),
    price: Object.freeze({
        font: 'liberation-sans',
        size: 'M',
        color: '#C0182B',
    }),
    position: Object.freeze({
        align: 'center',
        vertical: 'center',
        order: 'label-first',
    }),
});

/** Seções aceitas no payload. Chave fora daqui é erro, não é ignorada. */
const STYLE_SECTIONS = Object.freeze(['card', 'label', 'price', 'position']);

/** Campos aceitos por seção. */
const STYLE_FIELDS = Object.freeze({
    card:     Object.freeze(['background_color', 'opacity']),
    label:    Object.freeze(['font', 'size', 'color', 'uppercase', 'max_lines']),
    price:    Object.freeze(['font', 'size', 'color']),
    position: Object.freeze(['align', 'vertical', 'order']),
});

/**
 * `#1A2B3C` → `[26, 43, 60]`. Usado para montar o `rgba()` do card.
 *
 * @param {string} hex
 * @returns {number[]}
 */
function hexToRgbChannels(hex) {
    const value = String(hex).replace('#', '');
    return [
        parseInt(value.slice(0, 2), 16),
        parseInt(value.slice(2, 4), 16),
        parseInt(value.slice(4, 6), 16),
    ];
}

/** @private Lista de opções para a mensagem de erro. */
function options(list) {
    return list.join(', ');
}

/**
 * Primeiro problema encontrado no estilo recebido, ou `null`.
 *
 * Devolve mensagem em vez de lançar: a convenção do módulo é que o domínio
 * diagnostica e o caso de uso decide o status HTTP (ver `product-grid.rules`).
 *
 * `undefined` e `null` são válidos — significam "sem estilo próprio", e a grade
 * usa o padrão.
 *
 * @param {*} raw
 * @returns {string|null}
 */
function findStyleError(raw) {
    if (raw === undefined || raw === null) return null;

    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return 'O campo "style" precisa ser um objeto.';
    }

    for (const section of Object.keys(raw)) {
        if (!STYLE_SECTIONS.includes(section)) {
            return `Seção de estilo desconhecida: "${section}". Use ${options(STYLE_SECTIONS)}.`;
        }
        const block = raw[section];
        if (block === undefined || block === null) continue;
        if (typeof block !== 'object' || Array.isArray(block)) {
            return `A seção "${section}" do estilo precisa ser um objeto.`;
        }
        for (const field of Object.keys(block)) {
            if (!STYLE_FIELDS[section].includes(field)) {
                return `Campo de estilo desconhecido: "${section}.${field}". `
                     + `Aceitos: ${options(STYLE_FIELDS[section])}.`;
            }
        }
    }

    const card = raw.card ?? {};
    if (card.background_color !== undefined && !HEX_COLOR.test(String(card.background_color))) {
        return 'A cor do card precisa ser hexadecimal de 6 dígitos, como "#FFFFFF".';
    }
    if (card.opacity !== undefined) {
        const opacity = Number(card.opacity);
        if (!Number.isFinite(opacity) || opacity < MIN_OPACITY || opacity > MAX_OPACITY) {
            return `A opacidade do card precisa estar entre ${MIN_OPACITY} e ${MAX_OPACITY}.`;
        }
    }

    for (const part of ['label', 'price']) {
        const block = raw[part] ?? {};
        if (block.font !== undefined && !(block.font in FONT_FAMILIES)) {
            return `Fonte desconhecida em "${part}": "${block.font}". `
                 + `Disponíveis: ${options(Object.keys(FONT_FAMILIES))}.`;
        }
        if (block.size !== undefined && !(String(block.size).toUpperCase() in SIZE_STEPS)) {
            return `Tamanho desconhecido em "${part}": "${block.size}". `
                 + `Disponíveis: ${options(Object.keys(SIZE_STEPS))}.`;
        }
        if (block.color !== undefined && !HEX_COLOR.test(String(block.color))) {
            return `A cor de "${part}" precisa ser hexadecimal de 6 dígitos, como "#10243F".`;
        }
    }

    const label = raw.label ?? {};
    if (label.uppercase !== undefined && typeof label.uppercase !== 'boolean') {
        return 'O campo "label.uppercase" precisa ser verdadeiro ou falso.';
    }
    if (label.max_lines !== undefined) {
        const lines = Number(label.max_lines);
        if (!Number.isInteger(lines) || lines < MIN_LABEL_LINES || lines > MAX_LABEL_LINES) {
            return 'O número de linhas da descrição precisa estar entre '
                 + `${MIN_LABEL_LINES} e ${MAX_LABEL_LINES}.`;
        }
    }

    const position = raw.position ?? {};
    if (position.align !== undefined && !ALIGNMENTS.includes(position.align)) {
        return `Alinhamento desconhecido: "${position.align}". Use ${options(ALIGNMENTS)}.`;
    }
    if (position.vertical !== undefined && !VERTICAL_ALIGNMENTS.includes(position.vertical)) {
        return `Posição vertical desconhecida: "${position.vertical}". `
             + `Use ${options(VERTICAL_ALIGNMENTS)}.`;
    }
    if (position.order !== undefined && !CONTENT_ORDERS.includes(position.order)) {
        return `Ordem desconhecida: "${position.order}". Use ${options(CONTENT_ORDERS)}.`;
    }

    return null;
}

/**
 * Estilo completo a partir do que veio, caindo no atual e depois no padrão.
 *
 * SEMPRE devolve o objeto inteiro, nunca parcial: é ele que entra no
 * `data_hash`, e um objeto com chaves faltando geraria hash diferente para a
 * mesma aparência.
 *
 * Pressupõe payload já aprovado por `findStyleError`.
 *
 * @param {*} raw            - o que veio do painel (pode ser `undefined`).
 * @param {object} [current] - estilo atual da grade, para o PUT parcial.
 * @returns {object} estilo normalizado.
 */
function normalizeStyle(raw, current = null) {
    const base = current ?? DEFAULT_STYLE;
    const given = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

    const pick = (section, field) => {
        const block = given[section];
        const value = (block && typeof block === 'object') ? block[field] : undefined;
        if (value !== undefined && value !== null) return value;
        const currentValue = base[section] ? base[section][field] : undefined;
        return currentValue === undefined || currentValue === null
            ? DEFAULT_STYLE[section][field]
            : currentValue;
    };

    return {
        card: {
            background_color: String(pick('card', 'background_color')).toUpperCase(),
            opacity: Math.round(Number(pick('card', 'opacity'))),
        },
        label: {
            font: String(pick('label', 'font')),
            size: String(pick('label', 'size')).toUpperCase(),
            color: String(pick('label', 'color')).toUpperCase(),
            uppercase: Boolean(pick('label', 'uppercase')),
            max_lines: Math.round(Number(pick('label', 'max_lines'))),
        },
        price: {
            font: String(pick('price', 'font')),
            size: String(pick('price', 'size')).toUpperCase(),
            color: String(pick('price', 'color')).toUpperCase(),
        },
        position: {
            align: String(pick('position', 'align')),
            vertical: String(pick('position', 'vertical')),
            order: String(pick('position', 'order')),
        },
    };
}

/**
 * Forma estável do estilo para a impressão digital.
 *
 * Array e não objeto: `JSON.stringify` preserva a ordem de inserção das chaves,
 * então dois objetos com o mesmo conteúdo em ordem diferente gerariam hashes
 * diferentes — e a grade re-renderizaria sem que nada tivesse mudado.
 *
 * @param {object} style - estilo cru ou normalizado.
 * @returns {Array}
 */
function styleFingerprint(style) {
    const value = normalizeStyle(style);
    return [
        value.card.background_color, value.card.opacity,
        value.label.font, value.label.size, value.label.color,
        value.label.uppercase, value.label.max_lines,
        value.price.font, value.price.size, value.price.color,
        value.position.align, value.position.vertical, value.position.order,
    ];
}

module.exports = {
    FONT_FAMILIES,
    SIZE_STEPS,
    ALIGNMENTS,
    VERTICAL_ALIGNMENTS,
    CONTENT_ORDERS,
    MIN_OPACITY,
    MAX_OPACITY,
    MIN_LABEL_LINES,
    MAX_LABEL_LINES,
    DEFAULT_STYLE,
    hexToRgbChannels,
    findStyleError,
    normalizeStyle,
    styleFingerprint,
};
