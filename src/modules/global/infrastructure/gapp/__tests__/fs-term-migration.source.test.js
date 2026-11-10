const fs = require('fs');
const os = require('os');
const path = require('path');
const { FsTermMigrationSource } = require('../fs-term-migration.source');

describe('FsTermMigrationSource', () => {
    let root;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'term-migration-'));
        fs.mkdirSync(path.join(root, 'sub'));
        fs.writeFileSync(path.join(root, '10-Fulano.pdf'), '%PDF-1.4 a');
        fs.writeFileSync(path.join(root, 'sub', '20-Ciclano.pdf'), '%PDF-1.4 b');
        fs.writeFileSync(path.join(root, 'Thumbs.db'), 'x');
        fs.writeFileSync(path.join(root, '.oculto'), 'x');
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    test('lista com caminho relativo, inclusive subpasta, sem lixo de sistema', async () => {
        const files = await new FsTermMigrationSource({ root }).list();
        expect(files.map(f => f.relativePath)).toEqual(['10-Fulano.pdf', 'sub/20-Ciclano.pdf']);
    });

    test('lê no formato do multer, com hash', async () => {
        const { file, sha256, fileNames } = await new FsTermMigrationSource({ root }).read('sub/20-Ciclano.pdf');
        expect(file.originalname).toBe('20-Ciclano.pdf');
        expect(Buffer.isBuffer(file.buffer)).toBe(true);
        expect(sha256).toHaveLength(64);
        expect(fileNames).toContain('20-Ciclano.pdf');
    });

    test('recusa sair da raiz', async () => {
        await expect(new FsTermMigrationSource({ root }).read('../etc/passwd')).rejects.toMatchObject({ statusCode: 400 });
    });

    test('arquivo ausente: 404 com código próprio', async () => {
        await expect(new FsTermMigrationSource({ root }).read('nao-existe.pdf'))
            .rejects.toMatchObject({ statusCode: 404, code: 'TERM_MIGRATION_SOURCE_FILE_MISSING' });
    });

    test('sem pasta configurada: 503', async () => {
        await expect(new FsTermMigrationSource({ root: '' }).list()).rejects.toMatchObject({ statusCode: 503 });
        await expect(new FsTermMigrationSource({ root: path.join(root, 'nada') }).list()).rejects.toMatchObject({ statusCode: 503 });
    });
});
