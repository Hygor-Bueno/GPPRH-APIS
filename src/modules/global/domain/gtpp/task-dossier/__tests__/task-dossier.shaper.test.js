const {
    buildTaskDossier, listEvidenceThumbSources, listAvatarThumbSources,
    itemTypeAndStatus, attachmentType, shapeScope, toLocalIsoDateTime, normalizeColor, thumbKey,
} = require('../task-dossier.shaper');
const { buildDossierLinks } = require('../task-dossier-links');
const { renderTaskDossierHtml } = require('../../../../../../templates/gtpp-dossier/task-dossier.template');

function makeData(overrides = {}) {
    return {
        task: {
            id: 4821, title: 'Inventário', full_description: 'Desc', priority: 2,
            initial_date: '2026-10-01', final_date: '2026-10-25', days_to_deadline: 5,
            disqualify: 0, state_id: 2, state_description: 'Fazendo', state_color: '#F5A623',
            creator_id: 7, creator_name: 'CRIADOR',
        },
        participants: [
            { id: 7, name: 'CRIADOR', active: 1, photo_file_path: 'storage/uploads/GTPP/a.webp', photo_file_type: 'image/webp' },
            { id: 3, name: 'INATIVO', active: 0, photo_file_path: null, photo_file_type: null },
        ],
        items: [
            { id: 10, order: 2, description: 'B', check: 0, yes_no: -1, overdue: 0, file_id: null, has_legacy_blob: 0 },
            { id: 11, order: 1, description: 'A', check: 1, yes_no: 0, overdue: 0, assigned_to: 3, assigned_name: 'INATIVO',
              file_id: 90, file_name: 'foto.webp', file_path: 'storage/uploads/GTPP/f.webp', file_type: 'image/webp', file_size: '1234' },
        ],
        responses: [
            { id: 100, task_item_id_fk: 11, comment: 'ok', created_at: '2026-10-14T07:50:00', author: 'FULANO' },
        ],
        responseFiles: [
            { id: 500, task_item_response_id_fk: 100, file_name: 'v.mp4', processing_status: 'failed', file_path: 'x.mp4', file_type: 'video/mp4', file_size: 10 },
            { id: 501, task_item_response_id_fk: 100, file_name: 'p.png', processing_status: 'ready', file_path: 'p.png', file_type: 'image/png', file_size: 20 },
        ],
        messages: [{ id: 1, description: 'oi', date_time: '2026-10-14 16:09:39', author: 'FULANO', file_id: null }],
        messagesTotal: 1,
        history: [{ description: 'Criada', date_time: '2026-10-01T08:00:00', state_description: 'A fazer', state_color: '#ccc' }],
        scope: [],
        legacyScope: [],
        ...overrides,
    };
}

describe('task-dossier.shaper', () => {
    describe('itemTypeAndStatus', () => {
        it.each([
            [{ yes_no: 0, check: 1 }, 'check', 'done'],
            [{ yes_no: 0, check: 0 }, 'check', 'pending'],
            [{ yes_no: -1, check: 0 }, 'question', 'unanswered'],
            [{ yes_no: 1, check: 0 }, 'question', 'answered_yes'],
            [{ yes_no: 2, check: 1 }, 'question', 'answered_no'],
        ])('%j → %s / %s', (row, type, status) => {
            expect(itemTypeAndStatus(row)).toEqual({ type, status });
        });
    });

    describe('attachmentType', () => {
        it('should classify by MIME, not by extension', () => {
            expect(attachmentType('image/webp')).toBe('image');
            expect(attachmentType('video/mp4')).toBe('video');
            expect(attachmentType('application/pdf')).toBe('pdf');
            expect(attachmentType('text/html')).toBe('other');
            expect(attachmentType(null)).toBe('other');
        });
    });

    describe('shapeScope', () => {
        it('should show code + name and "Todas/Todos" for null levels', () => {
            const out = shapeScope([{ company_code: '01', company_name: 'PEG PESE', branch_code: null, cost_center_code: '123', cost_center_name: null }]);
            expect(out).toEqual([{ company: '01 · PEG PESE', branch: 'Todas', cost_center: '123' }]);
        });

        it('should fall back to the legacy csds rows when there is no new scope', () => {
            const out = shapeScope([], [{ company_description: 'Empresa', shop_description: 'Loja 5', depart_description: 'Depto' }]);
            expect(out).toEqual([{ company: 'Empresa', branch: 'Loja 5', cost_center: 'Depto' }]);
        });
    });

    describe('normalizeColor', () => {
        it('should add the missing # that gt_task_state stores without', () => {
            expect(normalizeColor('9C2A0C')).toBe('#9C2A0C');
            expect(normalizeColor('#abc')).toBe('#abc');
            expect(normalizeColor('red')).toBeNull();
            expect(normalizeColor(null)).toBeNull();
        });
    });

    describe('toLocalIsoDateTime', () => {
        it('should format local components without timezone', () => {
            expect(toLocalIsoDateTime(new Date(2026, 9, 20, 14, 32, 5))).toBe('2026-10-20T14:32:05');
        });
    });

    describe('listEvidenceThumbSources', () => {
        it('should list only images, in document order, skipping failed ones', () => {
            const data = makeData();
            const items = [...data.items].sort((a, b) => a.order - b.order);
            const out = listEvidenceThumbSources({ ...data, items }, 300);
            expect(out.map(s => s.key)).toEqual([thumbKey.item(11), thumbKey.responseFile(501)]);
        });

        it('should cut at the maximum', () => {
            const out = listEvidenceThumbSources(makeData(), 1);
            expect(out).toHaveLength(1);
        });
    });

    describe('listAvatarThumbSources', () => {
        it('should skip participants without photo', () => {
            expect(listAvatarThumbSources(makeData().participants)).toEqual([
                { key: thumbKey.user(7), filePath: 'storage/uploads/GTPP/a.webp' },
            ]);
        });
    });

    describe('buildTaskDossier', () => {
        const thumbs = new Map([[thumbKey.item(11), 'data:image/jpeg;base64,AAA'], [thumbKey.user(7), 'data:image/jpeg;base64,BBB']]);
        const dossier = buildTaskDossier({
            data: makeData(), thumbs, generatedAt: new Date(2026, 9, 20, 14, 32), viewer: { id: 12, name: 'GERADOR' },
        });

        it('should fill the task header and compute percent from item statuses', () => {
            expect(dossier.task).toMatchObject({
                id: 4821, title: 'Inventário', priority: 2, days_to_deadline: 5, disqualified: false,
                state: { id: 2, description: 'Fazendo', color: '#F5A623' },
                creator: { id: 7, name: 'CRIADOR' },
            });
            expect(dossier.task.percent).toBe(50); // 1 concluído de 2
        });

        it('should mark the creator and inactive participants', () => {
            expect(dossier.participants).toEqual([
                { id: 7, name: 'CRIADOR', active: true, photo: 'data:image/jpeg;base64,BBB', is_creator: true },
                { id: 3, name: 'INATIVO', active: false, photo: null, is_creator: false },
            ]);
        });

        it('should attach comments and their files to the right item', () => {
            const a = dossier.items.find(i => i.order === 1);
            expect(a.attachment).toMatchObject({ name: 'foto.webp', type: 'image', size: 1234, thumb: 'data:image/jpeg;base64,AAA' });
            expect(a.comments).toHaveLength(1);
            expect(a.comments[0].attachments.map(f => [f.type, f.processing_status])).toEqual([['video', 'failed'], ['image', 'ready']]);
            expect(a.assigned_to).toEqual({ id: 3, name: 'INATIVO' });
        });

        it('should keep the legacy BLOB file as an index-only attachment', () => {
            const d = buildTaskDossier({
                data: makeData({ items: [{ id: 9, order: 1, yes_no: 0, check: 0, file_id: null, has_legacy_blob: 1, legacy_blob_size: 77 }] }),
                generatedAt: new Date(), viewer: { id: 1, name: 'X' },
            });
            expect(d.items[0].attachment).toEqual({ name: 'arquivo-item-9', type: 'other', size: 77, thumb: null, processing_status: 'ready', url: null });
        });

        it('should map chat and history dates as local text', () => {
            expect(dossier.messages[0]).toMatchObject({ created_at: '2026-10-14 16:09:39', text: 'oi', attachment: null });
            expect(dossier.messages_total).toBe(1);
            expect(dossier.history[0]).toMatchObject({ created_at: '2026-10-01T08:00:00', state: { description: 'A fazer' } });
            expect(dossier.generated_at).toBe('2026-10-20T14:32:00');
            expect(dossier.generated_by).toEqual({ id: 12, name: 'GERADOR' });
        });
    });

    describe('links para o GTPP', () => {
        const base = 'https://gigpp.com.br:73/services/gtpp?task=4821';
        const withLinks = buildTaskDossier({
            data: makeData(), generatedAt: new Date(2026, 9, 20), viewer: { id: 1, name: 'X' },
            links: buildDossierLinks('https://gigpp.com.br:73'),
        });

        it('should link the task, each item and each attachment to the front', () => {
            expect(withLinks.task.url).toBe(base);
            const a = withLinks.items.find(i => i.order === 1);
            expect(a.url).toBe(`${base}&item=11`);
            expect(a.attachment.url).toBe(`${base}&item=11&file=item`);
            expect(a.comments[0].attachments.map(f => f.url)).toEqual([`${base}&item=11&attachment=500`, `${base}&item=11&attachment=501`]);
        });

        it('should link the chat attachment to its message', () => {
            const d = buildTaskDossier({
                data: makeData({ messages: [{ id: 65, description: '', date_time: '2026-10-14 16:09:39', author: 'A', file_id: 9, file_name: 'n.pdf', file_type: 'application/pdf' }] }),
                generatedAt: new Date(), viewer: { id: 1, name: 'X' }, links: buildDossierLinks('https://gigpp.com.br:73'),
            });
            expect(d.messages[0].attachment.url).toBe(`${base}&message=65`);
        });

        it('should leave every url null without links', () => {
            const d = buildTaskDossier({ data: makeData(), generatedAt: new Date(), viewer: { id: 1, name: 'X' } });
            expect(d.task.url).toBeNull();
            expect(d.items.every(i => i.url === null && (!i.attachment || i.attachment.url === null))).toBe(true);
        });

        it('should render the links as anchors in the HTML, escaped', () => {
            const html = renderTaskDossierHtml(withLinks);
            expect(html).toContain(`href="${base.replace(/&/g, '&amp;')}"`);
            expect(html).toContain(`href="${base}&amp;item=11&amp;attachment=501"`);
            expect(html).toContain('Abrir a tarefa no GTPP');
        });

        it('should drop a non-http url in the template', () => {
            const d = { ...withLinks, task: { ...withLinks.task, url: 'javascript:alert(1)' } };
            expect(renderTaskDossierHtml(d)).not.toContain('javascript:alert(1)');
        });
    });
});
