/**
 * @fileoverview Testes do shaper de item de playlist.
 */

const {
    resolveDuration,
    isPlayable,
    shapeItems,
    FALLBACK_DURATION_SECONDS,
} = require('../playlist-item.shaper');

const signUrl = (uuid) => `https://exemplo/assinada/${uuid}`;

function makeRow(overrides = {}) {
    return {
        item_id: 1,
        order_index: 0,
        transition: 'none',
        duration_override: null,
        media_uuid: 'uuid-a',
        title: 'Cartaz',
        type: 'image',
        mime_type: 'image/webp',
        size_bytes: 1024,
        duration_seconds: 15,
        checksum: 'abc',
        status: 'ready',
        file_id: '42',
        ...overrides,
    };
}

describe('duração efetiva', () => {
    it('o override vence a duração da mídia', () => {
        expect(resolveDuration({ duration_override: 30, duration_seconds: 15 })).toBe(30);
    });

    it('sem override, usa a duração da mídia', () => {
        expect(resolveDuration({ duration_override: null, duration_seconds: 15 })).toBe(15);
    });

    it('trata override 0 como não preenchido', () => {
        // A coluna é UNSIGNED e aceita 0; um item de duração zero travaria o
        // carrossel do player num laço apertado.
        expect(resolveDuration({ duration_override: 0, duration_seconds: 15 })).toBe(15);
    });

    it('cai no fallback quando nem um nem outro servem', () => {
        expect(resolveDuration({ duration_override: null, duration_seconds: 0 }))
            .toBe(FALLBACK_DURATION_SECONDS);
    });
});

describe('o que pode ir para a tela', () => {
    it('só mídia pronta é tocável', () => {
        expect(isPlayable(makeRow({ status: 'ready' }))).toBe(true);
        expect(isPlayable(makeRow({ status: 'processing' }))).toBe(false);
        expect(isPlayable(makeRow({ status: 'uploading' }))).toBe(false);
        expect(isPlayable(makeRow({ status: 'error' }))).toBe(false);
    });

    it('weburl é tocável independente do status, porque não tem binário', () => {
        expect(isPlayable(makeRow({ type: 'weburl', status: 'uploading' }))).toBe(true);
    });
});

describe('montagem da lista', () => {
    it('ordena por order_index e descarta o que não está pronto', () => {
        const rows = [
            makeRow({ item_id: 3, order_index: 2, media_uuid: 'c' }),
            makeRow({ item_id: 1, order_index: 0, media_uuid: 'a' }),
            makeRow({ item_id: 2, order_index: 1, media_uuid: 'b', status: 'processing' }),
        ];

        const items = shapeItems(rows, signUrl);

        // O item em processamento sai da lista sem derrubar os outros: uma
        // mídia ainda convertendo não pode parar a veiculação da tela.
        expect(items.map((item) => item.media.uuid)).toEqual(['a', 'c']);
    });

    it('assina a URL das mídias com binário', () => {
        const [item] = shapeItems([makeRow({ media_uuid: 'uuid-x' })], signUrl);
        expect(item.media.url).toBe('https://exemplo/assinada/uuid-x');
    });

    it('weburl aponta direto para a URL cadastrada, sem assinatura', () => {
        const rows = [makeRow({ type: 'weburl', file_id: 'https://externo/painel' })];
        const [item] = shapeItems(rows, signUrl);
        expect(item.media.url).toBe('https://externo/painel');
    });

    it('lista vazia não quebra', () => {
        expect(shapeItems([], signUrl)).toEqual([]);
        expect(shapeItems(undefined, signUrl)).toEqual([]);
    });
});
