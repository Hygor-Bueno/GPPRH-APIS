/**
 * @fileoverview Casos de uso — Task Item Response GTPP (respostas/evidências de item).
 *
 * Sem `taskGuardRepository`: esta sub-feature nunca checa editabilidade ou
 * dono da tarefa hoje — preservado como está (não é invariante nova a impor).
 *
 * @module modules/global/application/gtpp/task-item-response/gtpp-task-item-response.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { MAX_REQUEST_BYTES } = require('../../../../../utils/file/constants');
const { shapeItemResponses, toFileDTOs, buildLegacyFileFields } = require('../../../domain/gtpp/task-item-response/task-item-response.shaper');

// Tipo 7 = novo comentário/evidência | Tipo 9 = comentário deletado | Tipo 10 = comentário editado
const EV_RESPONSE_NEW     = 7;
const EV_RESPONSE_DELETED = 9;
const EV_RESPONSE_UPDATED = 10;

/** Espelha a coluna `gt_task_item_response.comment` VARCHAR(1000). */
const COMMENT_MAX = 1000;

class GtppTaskItemResponseUseCases {
    /**
     * @param {{
     *   repository: import('./ports/task-item-response-repository.port').TaskItemResponseRepositoryPort,
     *   eventPublisher: import('../ports/gtpp-event-publisher.port').GtppEventPublisherPort,
     * }} deps
     */
    constructor({ repository, eventPublisher }) {
        this.repository = repository;
        this.eventPublisher = eventPublisher;
    }

    /**
     * Comentários ativos do item, cada um com sua lista `files[]`.
     *
     * Duas consultas em série (não em paralelo): o pool do `global` é
     * compartilhado por todo o cluster e já bateu no teto de conexões.
     *
     * @param {number} taskItemId
     * @returns {Promise<import('../../../domain/gtpp/task-item-response/task-item-response.shaper').TaskItemResponseDTO[]>}
     */
    async getItemResponses(taskItemId) {
        const responses = await this.repository.findByItem(taskItemId);
        if (responses.length === 0) return [];

        const files = await this.repository.findFilesByItem(taskItemId);
        return shapeItemResponses(responses, files);
    }

    /**
     * Adiciona uma resposta/evidência a um item. Aceita zero ou mais arquivos.
     *
     * O conteúdo pode ser texto, anexo, ou os dois — só é rejeitado o comentário
     * sem nada. É a mesma regra do chat da tarefa (`GtppMessageUseCases.sendMessage`:
     * `!description && !file`), que sempre aceitou arquivo sem texto: o gesto do
     * usuário é o mesmo (anexar evidência), não faz sentido divergir entre os dois
     * endpoints do módulo.
     *
     * Sem texto, `comment` é gravado como NULL — a coluna é anulável e é assim
     * que o chat já grava (`description ?? null`). String vazia não é usada em
     * lugar nenhum do módulo.
     *
     * @param {number} taskItemId @param {number} userId
     * @param {{comment?:string, files?:Express.Multer.File[]}} data
     * @throws {AppError} 404 item inexistente / 400 sem conteúdo ou texto longo demais
     */
    async createItemResponse(taskItemId, userId, { comment, files = [] }) {
        const taskId = await this.repository.findTaskIdByItemId(taskItemId);
        if (!taskId) throw new AppError('Item não encontrado.', 404);

        const text = typeof comment === 'string' ? comment.trim() : '';

        if (!text && files.length === 0) {
            throw new AppError('Informe um comentário ou ao menos um anexo.', 400);
        }
        // Sem isto, texto acima do limite da coluna vira erro 1406 do MySQL
        // (sql_mode STRICT_TRANS_TABLES) e sai como 500 em vez de 400.
        if (text.length > COMMENT_MAX) {
            throw new AppError(`O comentário deve ter no máximo ${COMMENT_MAX} caracteres.`, 400);
        }

        // O multer valida cada arquivo isoladamente, nunca a soma. Com vídeo na
        // whitelist, 10 anexos no teto individual bufferizam 500 MB em RAM e
        // derrubam o worker (`max_memory_restart: "1G"`). Barrado antes de
        // qualquer gravação em disco.
        const totalBytes = files.reduce((sum, file) => sum + (file?.size ?? 0), 0);
        if (totalBytes > MAX_REQUEST_BYTES) {
            const limitMb = Math.round(MAX_REQUEST_BYTES / 1024 / 1024);
            throw new AppError(`Os anexos somam mais de ${limitMb} MB. Envie em partes.`, 400);
        }

        const result = await this.repository.create(taskItemId, userId, { comment: text || null, files });

        // No evento, `comment` vai como string SEMPRE (vazia quando não há texto),
        // e não como o NULL que foi persistido: o payload é notificação, não
        // registro, e manter o tipo estável protege cliente antigo que faz
        // `comment.trim()` sem checar. Revisitar quando o front web migrar.
        this.eventPublisher
            .broadcastEvent(taskId, userId, EV_RESPONSE_NEW, {
                action: 'created', id: result.responseId, item_id: taskItemId, comment: text,
            })
            .catch(() => {});

        const createdFiles = toFileDTOs(result.files ?? []);

        // `file_id`/`file_name` no nível do comentário são @deprecated — ver shaper.
        return { responseId: result.responseId, files: createdFiles, ...buildLegacyFileFields(createdFiles) };
    }

    /** @throws {AppError} 400/404 */
    async updateItemResponse(responseId, comment, taskItemId, userId) {
        if (!comment || !comment.trim()) throw new AppError('O comentário é obrigatório.', 400);

        const { affectedRows } = await this.repository.update(responseId, comment.trim());
        if (affectedRows === 0) throw new AppError('Resposta não encontrada ou já excluída.', 404);

        const taskId = await this.repository.findTaskIdByItemId(taskItemId);
        if (taskId) {
            this.eventPublisher
                .broadcastEvent(taskId, userId, EV_RESPONSE_UPDATED, {
                    action: 'updated', id: responseId, item_id: taskItemId, comment,
                })
                .catch(() => {});
        }
    }

    /** @throws {AppError} 404 */
    async deleteItemResponse(responseId, taskItemId, userId) {
        // Busca o task_id ANTES de deletar, para ainda conseguir emitir o evento.
        const taskId = await this.repository.findTaskIdByItemId(taskItemId);

        const { affectedRows } = await this.repository.softDelete(responseId, userId);
        if (affectedRows === 0) throw new AppError('Resposta não encontrada.', 404);

        if (taskId) {
            this.eventPublisher
                .broadcastEvent(taskId, userId, EV_RESPONSE_DELETED, {
                    action: 'deleted', id: responseId, item_id: taskItemId,
                })
                .catch(() => {});
        }
    }

    /**
     * Remove (soft delete, `status = 0`) UM anexo de um comentário, sem tocar
     * nos demais. `attachmentId` é o id em `gt_task_item_response_files`, não o
     * `_files.id` — o arquivo em si é preservado, já que a deduplicação por
     * hash permite que outro comentário aponte para o mesmo `file_id`.
     *
     * Emite o evento 10 no MESMO formato de uma edição de comentário
     * (`action: 'updated'` + `comment`): o comentário mudou de conteúdo, e
     * assim os clientes antigos, que não conhecem anexo, recarregam sem
     * precisar de mudança no front.
     *
     * @param {{taskItemId:number, responseId:number, attachmentId:number, userId:number}} params
     * @throws {AppError} 404 se o anexo não existir, já estiver removido ou não
     *                    pertencer a esse comentário/item.
     */
    async deleteItemResponseFile({ taskItemId, responseId, attachmentId, userId }) {
        const { affectedRows } = await this.repository.softDeleteFile({
            attachmentId, responseId, taskItemId, userId,
        });
        if (affectedRows === 0) throw new AppError('Anexo não encontrado ou já removido.', 404);

        const taskId = await this.repository.findTaskIdByItemId(taskItemId);
        if (taskId) {
            const response = await this.repository.findResponseById(responseId);
            this.eventPublisher
                .broadcastEvent(taskId, userId, EV_RESPONSE_UPDATED, {
                    action: 'updated', id: responseId, item_id: taskItemId, comment: response?.comment ?? '',
                })
                .catch(() => {});
        }

        const files = await this.repository.findFilesByResponse(responseId);
        return { responseId, files: toFileDTOs(files) };
    }
}

module.exports = { GtppTaskItemResponseUseCases };
