/**
 * @fileoverview Regras do quadro de capa.
 *
 * Tudo aqui é puro: nenhum teste chama ffmpeg. O que se garante é o contrato
 * com o worker — quais arquivos entram na varredura, onde a capa é gravada e
 * com quais argumentos o ffmpeg é chamado.
 */

'use strict';

const {
    POSTER_EXTENSION,
    POSTER_MIME,
    needsPoster,
    posterPathFor,
    buildPosterArgs,
} = require('../poster-policy');

describe('needsPoster', () => {
    it('aceita qualquer video/*, não só os transcodáveis', () => {
        // Um H.264 pequeno nunca entra na fila de conversão, mas aparece na
        // biblioteca igual aos outros — e a miniatura dele pesa o mesmo.
        expect(needsPoster({ file_type: 'video/mp4' })).toBe(true);
        expect(needsPoster({ file_type: 'video/quicktime' })).toBe(true);
        expect(needsPoster({ file_type: 'video/x-matroska' })).toBe(true);
    });

    it('lê tanto `mime_type` quanto `file_type`', () => {
        // `_files` chama a coluna de `file_type`; o resto do módulo usa
        // `mime_type`. Aceitar os dois evita um mapeamento só para isto.
        expect(needsPoster({ mime_type: 'video/mp4' })).toBe(true);
        expect(needsPoster({ file_type: 'video/mp4' })).toBe(true);
    });

    it('recusa o que não é vídeo', () => {
        expect(needsPoster({ file_type: 'image/webp' })).toBe(false);
        expect(needsPoster({ file_type: 'application/pdf' })).toBe(false);
        expect(needsPoster({})).toBe(false);
        expect(needsPoster(null)).toBe(false);
    });
});

describe('posterPathFor', () => {
    it('grava ao lado do vídeo, trocando a extensão', () => {
        expect(posterPathFor('Storage/MIEPP/uploads/2026/09/16/abc123.mp4'))
            .toBe(`Storage/MIEPP/uploads/2026/09/16/abc123.poster.${POSTER_EXTENSION}`);
    });

    it('normaliza separador do Windows', () => {
        // O worker roda em Linux, mas o caminho pode ter sido montado em
        // máquina Windows durante desenvolvimento.
        expect(posterPathFor('Storage\\GTPP\\uploads\\2026\\09\\11\\def456.mp4'))
            .toBe(`Storage/GTPP/uploads/2026/09/11/def456.poster.${POSTER_EXTENSION}`);
    });

    it('é determinístico — o mesmo vídeo sempre dá a mesma capa', () => {
        // É o que dispensa uma linha própria em `_files` para a capa.
        const video = 'Storage/MIEPP/uploads/2026/09/16/abc123.mp4';
        expect(posterPathFor(video)).toBe(posterPathFor(video));
    });

    it('não confunde ponto no meio do nome com extensão', () => {
        expect(posterPathFor('Storage/MIEPP/uploads/2026/09/16/v1.2.final.mp4'))
            .toBe(`Storage/MIEPP/uploads/2026/09/16/v1.2.final.poster.${POSTER_EXTENSION}`);
    });
});

describe('buildPosterArgs', () => {
    it('busca ANTES de abrir o arquivo, para não decodificar o vídeo inteiro', () => {
        const args = buildPosterArgs('/in.mp4', '/out.jpg', 1);

        // `-ss` depois de `-i` faz o ffmpeg decodificar até o ponto pedido: num
        // vídeo longo é a diferença entre milissegundos e dezenas de segundos.
        expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    });

    it('extrai um único quadro', () => {
        const args = buildPosterArgs('/in.mp4', '/out.jpg');
        expect(args).toEqual(expect.arrayContaining(['-frames:v', '1']));
    });

    it('reduz sem ampliar vídeo estreito', () => {
        const filtro = buildPosterArgs('/in.mp4', '/out.jpg')[
            buildPosterArgs('/in.mp4', '/out.jpg').indexOf('-vf') + 1
        ];

        expect(filtro).toContain('min(');
        // Altura par: o encoder JPEG recusa dimensão ímpar.
        expect(filtro).toContain(':-2');
    });

    it('aceita busca no segundo zero, para vídeo mais curto que o padrão', () => {
        const args = buildPosterArgs('/in.mp4', '/out.jpg', 0);
        expect(args[args.indexOf('-ss') + 1]).toBe('0');
    });

    it('nunca gera busca negativa', () => {
        const args = buildPosterArgs('/in.mp4', '/out.jpg', -5);
        expect(args[args.indexOf('-ss') + 1]).toBe('0');
    });

    it('sobrescreve a saída e põe o destino por último', () => {
        const args = buildPosterArgs('/in.mp4', '/out.jpg');
        expect(args).toContain('-y');
        expect(args[args.length - 1]).toBe('/out.jpg');
    });
});

describe('formato da capa', () => {
    it('é JPEG', () => {
        // Não WebP: a capa também é aberta por TV e navegador antigo.
        expect(POSTER_EXTENSION).toBe('jpg');
        expect(POSTER_MIME).toBe('image/jpeg');
    });
});
