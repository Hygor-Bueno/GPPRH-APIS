const express = require('express');
const multer = require('multer');
const request = require('supertest');

const { withUploadLimit, UploadErrorCode } = require('../upload-limit');
const { errorHandler } = require('../../../middlewares/error.middleware');

const LIMIT = 1024 * 1024; // 1 MB

function buildApp(upload) {
    const app = express();
    app.post('/single', upload.single('file'), (req, res) => res.json({ size: req.file.size }));
    app.post('/fields', upload.fields([{ name: 'file', maxCount: 1 }]),
        (req, res) => res.json({ size: req.files.file[0].size }));
    app.use(errorHandler);
    return app;
}

const app = buildApp(withUploadLimit(
    multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMIT } }),
    LIMIT
));

describe('withUploadLimit', () => {
    it('responde com o limite real da instância e código próprio', async () => {
        const res = await request(app)
            .post('/single')
            .attach('file', Buffer.alloc(LIMIT + 1), 'grande.bin');

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(UploadErrorCode.FILE_TOO_LARGE);
        expect(res.body.message).toBe('Arquivo muito grande. Tamanho máximo permitido: 1 MB.');
    });

    it('vale também para .fields()', async () => {
        const res = await request(app)
            .post('/fields')
            .attach('file', Buffer.alloc(LIMIT + 1), 'grande.bin');

        expect(res.body.code).toBe(UploadErrorCode.FILE_TOO_LARGE);
    });

    it('não interfere em upload dentro do limite', async () => {
        const res = await request(app)
            .post('/single')
            .attach('file', Buffer.alloc(10), 'pequeno.bin');

        expect(res.status).toBe(200);
        expect(res.body.size).toBe(10);
    });

    it('deixa os demais erros do multer seguirem para o handler global', async () => {
        const res = await request(app)
            .post('/single')
            .attach('outro', Buffer.alloc(10), 'pequeno.bin');

        expect(res.status).toBe(400);
        expect(res.body.code).toBeUndefined();
        expect(res.body.message).toMatch(/Campo de arquivo inesperado/);
    });
});
