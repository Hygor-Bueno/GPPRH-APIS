const {
    buildLegacyFileFields,
    toFileDTO,
    shapeItemResponse,
    shapeItemResponses,
} = require('../task-item-response.shaper');

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

describe('task-item-response.shaper', () => {
    describe('toFileDTO', () => {
        it('should drop the grouping key so it does not leak into the payload', () => {
            expect(toFileDTO(fileRow())).not.toHaveProperty('task_item_response_id_fk');
        });

        it('should normalize a missing `_files` join (orphan file_id) to nulls', () => {
            const dto = toFileDTO({ id: 1, file_id: 700, file_name: 'x.pdf', status: 1, created_at: 'x' });

            expect(dto).toMatchObject({
                file_path: null, file_extension: null, file_type: null, file_size: null,
            });
        });
    });

    describe('toFileDTO — vídeo', () => {
    it('should flag HEVC as not playable on the web', () => {
        const dto = toFileDTO(fileRow({ file_type: 'video/mp4', video_codec: 'hevc' }));

        expect(dto).toMatchObject({ video_codec: 'hevc', web_playable: false });
    });

    it('should flag H.264 as playable', () => {
        const dto = toFileDTO(fileRow({ file_type: 'video/mp4', video_codec: 'h264' }));

        expect(dto).toMatchObject({ video_codec: 'h264', web_playable: true });
    });

    // null = "não se aplica". Um PDF não é "não tocável", ele não é vídeo.
    it('should leave both fields null for anything that is not video', () => {
        const dto = toFileDTO(fileRow({ file_type: 'application/pdf' }));

        expect(dto).toMatchObject({ video_codec: null, web_playable: null });
    });

    it('should expose the processing status, defaulting to ready', () => {
        expect(toFileDTO(fileRow({ processing_status: 'pending' })).processing_status).toBe('pending');
        // Anexo anterior à Fase B não traz a coluna — não pode virar undefined.
        expect(toFileDTO(fileRow()).processing_status).toBe('ready');
    });
});

describe('buildLegacyFileFields', () => {
        it('should return every deprecated field as null when there is no file', () => {
            expect(buildLegacyFileFields([])).toEqual({
                file_id: null, file_name: null, file_path: null,
                file_extension: null, file_type: null, file_size: null,
            });
        });

        it('should mirror the first file only', () => {
            const legacy = buildLegacyFileFields([
                toFileDTO(fileRow({ file_id: 700, file_name: 'a.pdf' })),
                toFileDTO(fileRow({ file_id: 701, file_name: 'b.pdf' })),
            ]);

            expect(legacy).toMatchObject({ file_id: 700, file_name: 'a.pdf' });
        });
    });

    describe('shapeItemResponse', () => {
        it('should keep every column of the response row untouched', () => {
            const row = { id: 10, task_item_id_fk: 3, comment: 'oi', status: 1, created_by_fk: 7, name: 'Fulano' };

            expect(shapeItemResponse(row, [])).toMatchObject(row);
        });
    });

    describe('shapeItemResponses', () => {
        it('should group the flat file list by response id, preserving order', () => {
            const responses = [{ id: 10 }, { id: 11 }, { id: 12 }];
            const files = [
                fileRow({ id: 1, task_item_response_id_fk: 10 }),
                fileRow({ id: 2, task_item_response_id_fk: 12 }),
                fileRow({ id: 3, task_item_response_id_fk: 10 }),
            ];

            const shaped = shapeItemResponses(responses, files);

            expect(shaped.map(r => r.files.map(f => f.id))).toEqual([[1, 3], [], [2]]);
        });

        it('should tolerate an empty file list', () => {
            expect(shapeItemResponses([{ id: 10 }])).toEqual([
                expect.objectContaining({ id: 10, files: [], file_id: null }),
            ]);
        });
    });
});
