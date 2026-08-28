/**
 * O que este teste protege é o cache da rota de arquivos.
 *
 * Ela é o maior consumidor de requisições da API — uma por foto de colaborador.
 * Sem `Cache-Control`, o `res.sendFile` manda `public, max-age=0` e o navegador
 * revalida a cada exibição; cada revalidação, mesmo devolvendo 304, conta no
 * rate limit. Foi o que estourava a cota de quem navegava por listas com foto.
 *
 * `FileService` é dublado porque o módulo real abre pool MySQL no import.
 */

const path = require('path');
const express = require('express');
const request = require('supertest');

jest.mock('../../../../utils/file/file.service', () => ({
    FileService: {
        findById: jest.fn(),
        absolutePath: jest.fn(),
        softDelete: jest.fn(),
    },
}));

const { FileService } = require('../../../../utils/file/file.service');
const filesController = require('../files.controller');

/** Um arquivo que existe de verdade, para o `sendFile` ter o que enviar. */
const ARQUIVO_REAL = path.resolve(__dirname, '..', '..', '..', '..', '..', 'package.json');

function buildApp() {
    const app = express();
    app.get('/files/:fileId', filesController.serveFile);
    return app;
}

beforeEach(() => {
    FileService.findById.mockResolvedValue({ id: 7, file_path: 'irrelevante' });
    FileService.absolutePath.mockReturnValue(ARQUIVO_REAL);
});

describe('GET /files/:fileId', () => {
    it('manda o arquivo', async () => {
        const res = await request(buildApp()).get('/files/7');
        expect(res.status).toBe(200);
    });

    it('permite o navegador reusar sem revalidar', async () => {
        const res = await request(buildApp()).get('/files/7');

        // O `max-age=0` que o send escreveria por conta própria é justamente o
        // que fazia cada exibição custar uma requisição.
        expect(res.headers['cache-control']).toBe('private, max-age=3600');
        expect(res.headers['cache-control']).not.toContain('max-age=0');
    });

    it('nunca marca como cacheável por proxy compartilhado', async () => {
        // A rota exige sessão: `public` deixaria um proxy guardar foto de
        // colaborador e entregar para quem não deveria ver.
        const res = await request(buildApp()).get('/files/7');
        expect(res.headers['cache-control']).toContain('private');
        expect(res.headers['cache-control']).not.toContain('public');
    });

    it('mantém o ETag, para a revalidação depois da hora ser barata', async () => {
        const res = await request(buildApp()).get('/files/7');
        expect(res.headers.etag).toBeDefined();
    });

    it('responde 404 quando o registro existe mas o arquivo não está em disco', async () => {
        FileService.absolutePath.mockReturnValue(path.join(__dirname, 'nao-existe.bin'));

        const res = await request(buildApp()).get('/files/7');

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: true, message: 'Arquivo não encontrado.' });
    });
});
