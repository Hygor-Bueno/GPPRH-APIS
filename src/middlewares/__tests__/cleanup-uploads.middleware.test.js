const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { cleanupUploads, collectTempPaths } = require('../cleanup-uploads.middleware');

/** Cria um temporário real, para provar que ele some de verdade. */
function makeTempFile(label) {
    const filePath = path.join(os.tmpdir(), `cleanup-test-${label}-${Date.now()}-${Math.random()}`);
    fs.writeFileSync(filePath, 'x');
    return filePath;
}

/** Resposta falsa que deixa disparar `finish`/`close` como o Express faria. */
function fakeRes() {
    return new EventEmitter();
}

/** O `unlink` é assíncrono — espera o event loop drenar. */
const flush = () => new Promise(resolve => setTimeout(resolve, 50));

describe('collectTempPaths — as três formas do multer', () => {
    it('should read req.file from .single()', () => {
        expect(collectTempPaths({ file: { path: '/tmp/a' } })).toEqual(['/tmp/a']);
    });

    it('should read the array from .array()', () => {
        expect(collectTempPaths({ files: [{ path: '/tmp/a' }, { path: '/tmp/b' }] }))
            .toEqual(['/tmp/a', '/tmp/b']);
    });

    it('should read the object of arrays from .fields()', () => {
        const req = { files: { files: [{ path: '/tmp/a' }], file: [{ path: '/tmp/b' }] } };

        expect(collectTempPaths(req).sort()).toEqual(['/tmp/a', '/tmp/b']);
    });

    it('should deduplicate, so the same path is not unlinked twice', () => {
        expect(collectTempPaths({ file: { path: '/tmp/a' }, files: [{ path: '/tmp/a' }] }))
            .toEqual(['/tmp/a']);
    });

    it('should tolerate a request with no upload at all', () => {
        expect(collectTempPaths({})).toEqual([]);
        expect(collectTempPaths({ files: null })).toEqual([]);
    });
});

describe('cleanupUploads', () => {
    it('should delete the temp file once the response finishes', async () => {
        const tempPath = makeTempFile('finish');
        const res = fakeRes();

        cleanupUploads({ file: { path: tempPath } }, res, () => {});
        res.emit('finish');
        await flush();

        expect(fs.existsSync(tempPath)).toBe(false);
    });

    // O upload grande abortado no meio fecha a conexão sem `finish` — sem este
    // caminho, ele deixaria 200 MB para trás.
    it('should delete the temp file when the connection closes instead', async () => {
        const tempPath = makeTempFile('close');
        const res = fakeRes();

        cleanupUploads({ file: { path: tempPath } }, res, () => {});
        res.emit('close');
        await flush();

        expect(fs.existsSync(tempPath)).toBe(false);
    });

    it('should delete every file of a multi-file request', async () => {
        const paths = [makeTempFile('m1'), makeTempFile('m2'), makeTempFile('m3')];
        const res = fakeRes();

        cleanupUploads({ files: paths.map(p => ({ path: p })) }, res, () => {});
        res.emit('finish');
        await flush();

        expect(paths.filter(fs.existsSync)).toEqual([]);
    });

    // Caminho feliz: o FileService já moveu o arquivo, então não há o que apagar.
    it('should not blow up when the file was already moved (ENOENT)', async () => {
        const res = fakeRes();

        cleanupUploads({ file: { path: path.join(os.tmpdir(), 'nao-existe-123') } }, res, () => {});
        expect(() => { res.emit('finish'); }).not.toThrow();
        await flush();
    });

    it('should run the cleanup only once when both events fire', async () => {
        const tempPath = makeTempFile('both');
        const res = fakeRes();
        const errors = [];
        const original = console.error;
        console.error = (...args) => errors.push(args);

        cleanupUploads({ file: { path: tempPath } }, res, () => {});
        res.emit('finish');
        res.emit('close');
        await flush();

        console.error = original;
        expect(fs.existsSync(tempPath)).toBe(false);
        expect(errors).toEqual([]);   // nenhum ENOENT de segunda passada
    });

    it('should call next so the request keeps going', () => {
        const next = jest.fn();

        cleanupUploads({}, fakeRes(), next);

        expect(next).toHaveBeenCalled();
    });
});
