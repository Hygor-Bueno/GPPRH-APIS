const { GtppTaskItemResponseUseCases } = require('../gtpp-task-item-response.use-cases');
const { TaskItemResponseRepositoryPort } = require('../ports/task-item-response-repository.port');
const { GtppEventPublisherPort } = require('../../ports/gtpp-event-publisher.port');
const { AppError } = require('../../../../../../errors/app.error');
const { MAX_REQUEST_BYTES } = require('../../../../../../utils/file/constants');

function makeFakeRepository(overrides = {}) {
    const repo = new TaskItemResponseRepositoryPort();
    repo.findByItem = jest.fn().mockResolvedValue([]);
    repo.findFilesByItem = jest.fn().mockResolvedValue([]);
    repo.findFilesByResponse = jest.fn().mockResolvedValue([]);
    repo.findResponseById = jest.fn().mockResolvedValue({ id: 1, comment: 'oi' });
    repo.findTaskIdByItemId = jest.fn().mockResolvedValue(5);
    repo.create = jest.fn().mockResolvedValue({ responseId: 99, files: [] });
    repo.update = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.softDelete = jest.fn().mockResolvedValue({ affectedRows: 1 });
    repo.softDeleteFile = jest.fn().mockResolvedValue({ affectedRows: 1 });
    return Object.assign(repo, overrides);
}

function makeFakeEventPublisher(overrides = {}) {
    const publisher = new GtppEventPublisherPort();
    publisher.broadcastEvent = jest.fn().mockResolvedValue();
    return Object.assign(publisher, overrides);
}

function makeUseCases({ repository, eventPublisher } = {}) {
    return new GtppTaskItemResponseUseCases({
        repository: repository ?? makeFakeRepository(),
        eventPublisher: eventPublisher ?? makeFakeEventPublisher(),
    });
}

/** Linha crua de `gt_task_item_response_files` + `_files`. */
function fileRow(overrides = {}) {
    return {
        id: 1,
        task_item_response_id_fk: 10,
        file_id: 700,
        file_name: 'nota.pdf',
        file_path: 'Storage/GTPP/uploads/2026/09/10/abc.pdf',
        file_extension: 'pdf',
        file_type: 'application/pdf',
        file_size: 1234,
        status: 1,
        created_at: '2026-09-10 10:00:00',
        ...overrides,
    };
}

describe('GtppTaskItemResponseUseCases', () => {
    describe('getItemResponses', () => {
        it('should attach each file to its own response as `files[]`', async () => {
            const repository = makeFakeRepository({
                findByItem: jest.fn().mockResolvedValue([{ id: 10, comment: 'a' }, { id: 11, comment: 'b' }]),
                findFilesByItem: jest.fn().mockResolvedValue([
                    fileRow({ id: 1, task_item_response_id_fk: 10 }),
                    fileRow({ id: 2, task_item_response_id_fk: 10, file_id: 701, file_name: 'foto.png' }),
                    fileRow({ id: 3, task_item_response_id_fk: 11, file_id: 702, file_name: 'x.png' }),
                ]),
            });

            const [first, second] = await makeUseCases({ repository }).getItemResponses(1);

            expect(first.files.map(f => f.id)).toEqual([1, 2]);
            expect(second.files.map(f => f.id)).toEqual([3]);
            expect(first.files[0]).not.toHaveProperty('task_item_response_id_fk');
        });

        it('should keep the deprecated file_id/file_name filled with the first file (front compatibility)', async () => {
            const repository = makeFakeRepository({
                findByItem: jest.fn().mockResolvedValue([{ id: 10, comment: 'a' }]),
                findFilesByItem: jest.fn().mockResolvedValue([
                    fileRow({ id: 1, file_id: 700, file_name: 'primeiro.pdf' }),
                    fileRow({ id: 2, file_id: 701, file_name: 'segundo.pdf' }),
                ]),
            });

            const [response] = await makeUseCases({ repository }).getItemResponses(1);

            expect(response.file_id).toBe(700);
            expect(response.file_name).toBe('primeiro.pdf');
            expect(response.file_path).toBe('Storage/GTPP/uploads/2026/09/10/abc.pdf');
        });

        it('should return the deprecated fields as null when the response has no file', async () => {
            const repository = makeFakeRepository({
                findByItem: jest.fn().mockResolvedValue([{ id: 10, comment: 'sem anexo' }]),
            });

            const [response] = await makeUseCases({ repository }).getItemResponses(1);

            expect(response.files).toEqual([]);
            expect(response).toMatchObject({ file_id: null, file_name: null, file_size: null });
        });

        it('should not query files at all when the item has no response', async () => {
            const repository = makeFakeRepository();
            const responses = await makeUseCases({ repository }).getItemResponses(1);

            expect(responses).toEqual([]);
            expect(repository.findFilesByItem).not.toHaveBeenCalled();
        });
    });

    describe('createItemResponse', () => {
        it('should throw 404 when the parent item does not exist (no direct DB access from the controller anymore)', async () => {
            const repository = makeFakeRepository({ findTaskIdByItemId: jest.fn().mockResolvedValue(null) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.createItemResponse(999, 10, { comment: 'oi' })).rejects.toThrow(AppError);
        });

        it('should throw 400 when there is neither text nor file', async () => {
            const useCases = makeUseCases();
            await expect(useCases.createItemResponse(1, 10, { comment: '  ' })).rejects.toThrow(AppError);
            await expect(useCases.createItemResponse(1, 10, {})).rejects.toThrow(AppError);
        });

        it('should accept files with no text — the photos ARE the comment', async () => {
            const files = [{ originalname: 'prateleira.jpg' }];

            await expect(makeUseCases().createItemResponse(1, 10, { comment: '', files }))
                .resolves.toBeDefined();
        });

        it('should persist a text-less comment as NULL, like the task chat does', async () => {
            const repository = makeFakeRepository();
            const files = [{ originalname: 'prateleira.jpg' }];

            await makeUseCases({ repository }).createItemResponse(1, 10, { comment: '   ', files });

            expect(repository.create).toHaveBeenCalledWith(1, 10, { comment: null, files });
        });

        it('should broadcast an empty string, never null, so old clients can call .trim()', async () => {
            const eventPublisher = makeFakeEventPublisher();
            const files = [{ originalname: 'prateleira.jpg' }];

            await makeUseCases({ eventPublisher }).createItemResponse(1, 10, { comment: undefined, files });

            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(5, 10, 7, {
                action: 'created', id: 99, item_id: 1, comment: '',
            });
        });

        it('should reject attachments that together exceed the request cap', async () => {
            const repository = makeFakeRepository();
            // Cada arquivo passa no limite individual; a soma é que estoura.
            const files = [
                { size: MAX_REQUEST_BYTES * 0.6 },
                { size: MAX_REQUEST_BYTES * 0.6 },
            ];

            await expect(makeUseCases({ repository }).createItemResponse(1, 10, { comment: 'oi', files }))
                .rejects.toThrow(AppError);
            expect(repository.create).not.toHaveBeenCalled();
        });

        it('should accept attachments right below the request cap', async () => {
            const files = [{ size: MAX_REQUEST_BYTES - 1 }];

            await expect(makeUseCases().createItemResponse(1, 10, { comment: 'oi', files }))
                .resolves.toBeDefined();
        });

        it('should reject text longer than the column, as 400 instead of a MySQL 500', async () => {
            const useCases = makeUseCases();
            await expect(useCases.createItemResponse(1, 10, { comment: 'x'.repeat(1001) })).rejects.toThrow(AppError);
        });

        it('should trim the text before persisting and broadcasting', async () => {
            const repository = makeFakeRepository();
            const eventPublisher = makeFakeEventPublisher();

            await makeUseCases({ repository, eventPublisher }).createItemResponse(1, 10, { comment: '  oi  ' });

            expect(repository.create).toHaveBeenCalledWith(1, 10, { comment: 'oi', files: [] });
            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(5, 10, 7,
                expect.objectContaining({ comment: 'oi' }));
        });

        it('should broadcast EV_RESPONSE_NEW (7) with the resolved task id', async () => {
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ eventPublisher });
            const result = await useCases.createItemResponse(1, 10, { comment: 'oi' });
            expect(result).toEqual({
                responseId: 99, files: [],
                file_id: null, file_name: null, file_path: null,
                file_extension: null, file_type: null, file_size: null,
            });
            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(5, 10, 7, { action: 'created', id: 99, item_id: 1, comment: 'oi' });
        });

        it('should forward the whole file list to the repository', async () => {
            const repository = makeFakeRepository();
            const files = [{ originalname: 'a.pdf' }, { originalname: 'b.pdf' }];

            await makeUseCases({ repository }).createItemResponse(1, 10, { comment: 'oi', files });

            expect(repository.create).toHaveBeenCalledWith(1, 10, { comment: 'oi', files });
        });

        it('should echo the created files and keep the deprecated fields on the first one', async () => {
            const repository = makeFakeRepository({
                create: jest.fn().mockResolvedValue({
                    responseId: 99,
                    files: [
                        fileRow({ id: 1, file_id: 700, file_name: 'a.pdf' }),
                        fileRow({ id: 2, file_id: 701, file_name: 'b.pdf' }),
                    ],
                }),
            });

            const result = await makeUseCases({ repository }).createItemResponse(1, 10, { comment: 'oi' });

            expect(result.files).toHaveLength(2);
            expect(result.file_id).toBe(700);
            expect(result.file_name).toBe('a.pdf');
        });
    });

    describe('updateItemResponse', () => {
        it('should throw 404 when nothing was updated', async () => {
            const repository = makeFakeRepository({ update: jest.fn().mockResolvedValue({ affectedRows: 0 }) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.updateItemResponse(1, 'novo', 5, 10)).rejects.toThrow(AppError);
        });

        it('should silently skip the broadcast when the parent item cannot be resolved', async () => {
            const repository = makeFakeRepository({ findTaskIdByItemId: jest.fn().mockResolvedValue(null) });
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ repository, eventPublisher });
            await expect(useCases.updateItemResponse(1, 'novo', 5, 10)).resolves.toBeUndefined();
            expect(eventPublisher.broadcastEvent).not.toHaveBeenCalled();
        });
    });

    describe('deleteItemResponse', () => {
        it('should throw 404 when nothing was deleted', async () => {
            const repository = makeFakeRepository({ softDelete: jest.fn().mockResolvedValue({ affectedRows: 0 }) });
            const useCases = makeUseCases({ repository });
            await expect(useCases.deleteItemResponse(1, 5, 10)).rejects.toThrow(AppError);
        });

        it('should resolve the task id before deleting, so the event can still be sent', async () => {
            const repository = makeFakeRepository();
            const eventPublisher = makeFakeEventPublisher();
            const useCases = makeUseCases({ repository, eventPublisher });
            await useCases.deleteItemResponse(1, 5, 10);
            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(5, 10, 9, { action: 'deleted', id: 1, item_id: 5 });
        });

        it('should pass the user id along, so the attachment cascade records who deleted it', async () => {
            const repository = makeFakeRepository();
            await makeUseCases({ repository }).deleteItemResponse(1, 5, 10);
            expect(repository.softDelete).toHaveBeenCalledWith(1, 10);
        });
    });

    describe('deleteItemResponseFile', () => {
        it('should throw 404 when the attachment does not belong to that comment/item', async () => {
            const repository = makeFakeRepository({ softDeleteFile: jest.fn().mockResolvedValue({ affectedRows: 0 }) });
            const useCases = makeUseCases({ repository });

            await expect(useCases.deleteItemResponseFile({ taskItemId: 5, responseId: 1, attachmentId: 42, userId: 10 }))
                .rejects.toThrow(AppError);
        });

        it('should scope the soft delete by item and comment', async () => {
            const repository = makeFakeRepository();
            await makeUseCases({ repository }).deleteItemResponseFile({ taskItemId: 5, responseId: 1, attachmentId: 42, userId: 10 });

            expect(repository.softDeleteFile).toHaveBeenCalledWith({
                attachmentId: 42, responseId: 1, taskItemId: 5, userId: 10,
            });
        });

        it('should broadcast EV_RESPONSE_UPDATED (10) in the same shape as a comment edit', async () => {
            const repository = makeFakeRepository({
                findResponseById: jest.fn().mockResolvedValue({ id: 1, comment: 'comentario atual' }),
            });
            const eventPublisher = makeFakeEventPublisher();

            await makeUseCases({ repository, eventPublisher })
                .deleteItemResponseFile({ taskItemId: 5, responseId: 1, attachmentId: 42, userId: 10 });

            expect(eventPublisher.broadcastEvent).toHaveBeenCalledWith(5, 10, 10, {
                action: 'updated', id: 1, item_id: 5, comment: 'comentario atual',
            });
        });

        it('should return the remaining files of the comment', async () => {
            const repository = makeFakeRepository({
                findFilesByResponse: jest.fn().mockResolvedValue([
                    fileRow({ id: 2, file_id: 701, file_name: 'restante.pdf' }),
                ]),
            });

            const result = await makeUseCases({ repository })
                .deleteItemResponseFile({ taskItemId: 5, responseId: 1, attachmentId: 42, userId: 10 });

            expect(result).toEqual({
                responseId: 1,
                files: [{
                    id: 2, file_id: 701, file_name: 'restante.pdf',
                    file_path: 'Storage/GTPP/uploads/2026/09/10/abc.pdf',
                    file_extension: 'pdf', file_type: 'application/pdf', file_size: 1234,
                    video_codec: null, web_playable: null, processing_status: 'ready',
                    status: 1, created_at: '2026-09-10 10:00:00',
                }],
            });
        });
    });
});
