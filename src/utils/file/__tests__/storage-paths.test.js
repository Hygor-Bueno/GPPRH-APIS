/**
 * @fileoverview Testes da tradução `file_path` → disco.
 *
 * O contrato que importa: o MIEPP vai para a raiz externa SEM mudar o
 * `file_path` gravado, e nenhum outro módulo é afetado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    STORAGE_ROOT,
    MOUNT_MARKER,
    readExternalRoots,
    moduleOf,
    resolveStoragePath,
    assertStorageReady,
} = require('../storage-paths');

const ROOTS = { MIEPP: path.resolve('/app/midias_marketing') };

describe('moduleOf', () => {
    it('lê o módulo do caminho do FileService', () => {
        expect(moduleOf('storage/uploads/MIEPP/2026/09/28/abc.mp4')).toBe('MIEPP');
    });

    it('devolve null para caminho fora do padrão (registros do PHP)', () => {
        expect(moduleOf('Storage/GTPP/uploads/2024/01/01/x.pdf')).toBeNull();
    });
});

describe('resolveStoragePath', () => {
    it('leva o MIEPP para a raiz externa, sem o prefixo storage/uploads', () => {
        expect(resolveStoragePath('storage/uploads/MIEPP/2026/09/28/abc.mp4', ROOTS))
            .toBe(path.join(ROOTS.MIEPP, 'MIEPP', '2026', '09', '28', 'abc.mp4'));
    });

    it('capa do vídeo segue o vídeo', () => {
        expect(resolveStoragePath('storage/uploads/MIEPP/2026/09/28/abc.poster.webp', ROOTS))
            .toBe(path.join(ROOTS.MIEPP, 'MIEPP', '2026', '09', '28', 'abc.poster.webp'));
    });

    it('não mexe nos outros módulos', () => {
        expect(resolveStoragePath('storage/uploads/GTPP/2026/09/28/x.pdf', ROOTS))
            .toBe(path.join(STORAGE_ROOT, 'storage/uploads/GTPP/2026/09/28/x.pdf'));
    });

    it('sem raiz configurada, o MIEPP continua local', () => {
        expect(resolveStoragePath('storage/uploads/MIEPP/2026/09/28/abc.mp4', {}))
            .toBe(path.join(STORAGE_ROOT, 'storage/uploads/MIEPP/2026/09/28/abc.mp4'));
    });
});

describe('readExternalRoots', () => {
    it('ignora variável vazia', () => {
        expect(readExternalRoots({ MIEPP_STORAGE_ROOT: '  ' })).toEqual({});
    });

    it('lê a raiz do MIEPP', () => {
        expect(readExternalRoots({ MIEPP_STORAGE_ROOT: '/app/midias_marketing' }))
            .toEqual({ MIEPP: path.resolve('/app/midias_marketing') });
    });
});

describe('assertStorageReady', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miepp-root-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('recusa com 503 quando a pasta de rede não está montada (sem marcador)', () => {
        // É o ponto de montagem vazio no disco local: gravar aqui perderia o
        // arquivo assim que a rede montasse por cima.
        expect(() => assertStorageReady('MIEPP', { MIEPP: dir }))
            .toThrow(expect.objectContaining({ statusCode: 503, code: 'STORAGE_UNAVAILABLE' }));
    });

    it('aceita quando o marcador existe', () => {
        fs.writeFileSync(path.join(dir, MOUNT_MARKER), '');
        expect(() => assertStorageReady('MIEPP', { MIEPP: dir })).not.toThrow();
    });

    it('não se aplica a módulo sem raiz externa', () => {
        expect(() => assertStorageReady('GTPP', { MIEPP: dir })).not.toThrow();
    });
});
