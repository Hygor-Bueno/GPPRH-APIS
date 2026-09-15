/**
 * @fileoverview Ponto único de integração do miepp com o sistema de arquivos
 * `_files` do módulo global.
 *
 * Todo o resto da suite fala só com esta classe. Se um dia o armazenamento
 * mudar (S3, CDN, servidor de mídia dedicado), é este arquivo que muda — nem
 * caso de uso, nem controller, nem query precisam saber.
 *
 * O `FileService` é colaborador direto, sem porta: é a convenção já firmada no
 * GTPP e no chat, porque ele é infraestrutura do próprio monolito e não um
 * serviço externo substituível.
 *
 * @module modules/global/infrastructure/miepp/miepp-media-storage.service
 */

const path = require('path');

const { FileService } = require('../../../../utils/file/file.service');
const { AppError } = require('../../../../errors/app.error');

/**
 * Nome do módulo em `_files`. O `validateModule` do FileService exige
 * maiúsculas, 2–8 caracteres — é também o diretório em que os binários caem.
 */
const STORAGE_MODULE = 'MIEPP';

class MieppMediaStorageService {
    /**
     * Grava o arquivo enviado e devolve os metadados que `miepp_media` guarda.
     *
     * O `_files` deduplica por SHA-256: enviar de novo o mesmo arquivo devolve
     * o registro existente sem gravar nada em disco. Duas mídias do miepp
     * apontando para o mesmo `file_id` é, portanto, normal e esperado — por
     * isso a exclusão de mídia nunca apaga o binário.
     *
     * @param {Express.Multer.File} file          - `req.file`.
     * @param {number|null}         globalUserId  - autor na sessão global (`_files.created_by`).
     * @returns {Promise<{file_id: number, mime_type: string, size_bytes: number,
     *                    checksum: string, pending_transcode: boolean}>}
     */
    async save(file, globalUserId) {
        if (!file) throw new AppError('Nenhum arquivo recebido.', 400);

        const record = await FileService.save(file, STORAGE_MODULE, globalUserId);

        return {
            file_id: record.id,
            mime_type: record.file_type,
            size_bytes: Number(record.file_size),
            checksum: record.file_hash,
            // O `_files` enfileira transcodificação de vídeo. Enquanto ela não
            // termina, a mídia fica `processing` e o player não a recebe.
            pending_transcode: Boolean(record.transcode_queued),
        };
    }

    /**
     * Resolve o arquivo para entrega.
     *
     * Devolve o caminho absoluto e o nome — a rota de entrega faz o `sendFile`,
     * igual ao `files.controller` do global. Não há redirect para o `_files`
     * porque aquela rota exige sessão de usuário, e quem baixa aqui é o player,
     * que só tem token de device.
     *
     * @param {number|string} fileId - `miepp_media.file_id`.
     * @returns {Promise<{absolutePath: string, fileName: string, mimeType: string}>}
     */
    async resolve(fileId) {
        const record = await FileService.findById(Number(fileId));

        if (!record) {
            throw new AppError('Arquivo da mídia não encontrado.', 404);
        }

        return {
            absolutePath: FileService.absolutePath(record),
            fileName: record.file_name || path.basename(record.file_path),
            mimeType: record.file_type,
        };
    }
}

module.exports = { MieppMediaStorageService, STORAGE_MODULE };
