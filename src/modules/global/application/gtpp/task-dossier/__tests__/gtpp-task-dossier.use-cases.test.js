const { GtppTaskDossierUseCases } = require('../gtpp-task-dossier.use-cases');
const { TaskDossierRepositoryPort } = require('../ports/task-dossier-repository.port');
const { DossierThumbnailPort } = require('../ports/dossier-thumbnail.port');
const { DossierPdfRendererPort } = require('../ports/dossier-pdf-renderer.port');
const { GtppScopeNameResolverPort } = require('../../ports/gtpp-scope-name-resolver.port');
const { GtppDossierErrorCode } = require('../../../../domain/gtpp/task-dossier/task-dossier.enums');
const { renderTaskDossierHtml } = require('../../../../../../templates/gtpp-dossier/task-dossier.template');

function makeData(overrides = {}) {
    return {
        task: { id: 5, title: 'T', creator_id: 10, state_id: 2, initial_date: '2026-10-01', final_date: '2026-10-25' },
        participants: [{ id: 10, name: 'CRIADOR', active: 1 }, { id: 20, name: 'COLAB', active: 1 }],
        items: [{ id: 1, order: 1, description: 'Foto', yes_no: 0, check: 0, file_id: 3, file_name: 'a.webp', file_path: 'a.webp', file_type: 'image/webp' }],
        responses: [], responseFiles: [], messages: [], messagesTotal: 0, history: [],
        scope: [], legacyScope: [],
        ...overrides,
    };
}

function makeFakes({ data = makeData() } = {}) {
    const repository = new TaskDossierRepositoryPort();
    repository.findDossierData = jest.fn().mockResolvedValue(data);
    repository.findViewer = jest.fn().mockResolvedValue({ id: 20, name: 'COLAB' });

    const thumbnailProvider = new DossierThumbnailPort();
    thumbnailProvider.toDataUri = jest.fn().mockResolvedValue('data:image/jpeg;base64,AAA');

    const renderer = new DossierPdfRendererPort();
    renderer.render = jest.fn().mockResolvedValue(Buffer.from('%PDF'));

    const scopeNameResolver = new GtppScopeNameResolverPort();
    scopeNameResolver.resolve = jest.fn(async rows => rows.map(r => ({ ...r, company_name: 'EMPRESA' })));

    return { repository, thumbnailProvider, renderer, scopeNameResolver };
}

function makeUseCases(fakes) {
    return new GtppTaskDossierUseCases({ ...fakes, now: () => new Date(2026, 9, 20, 14, 32) });
}

describe('GtppTaskDossierUseCases.generateDossier', () => {
    it('should 404 with a specific code when the task does not exist', async () => {
        const fakes = makeFakes();
        fakes.repository.findDossierData.mockResolvedValue(null);
        await expect(makeUseCases(fakes).generateDossier(5, { id: 10 }))
            .rejects.toMatchObject({ statusCode: 404, code: GtppDossierErrorCode.TASK_NOT_FOUND });
    });

    it('should 403 for a GTPP_USE user who is not part of the task', async () => {
        const fakes = makeFakes();
        await expect(makeUseCases(fakes).generateDossier(5, { id: 99, permissions: ['GTPP_USE'] }))
            .rejects.toMatchObject({ statusCode: 403, code: GtppDossierErrorCode.FORBIDDEN });
        expect(fakes.renderer.render).not.toHaveBeenCalled();
    });

    it.each([
        ['criador', { id: 10, permissions: ['GTPP_USE'] }],
        ['participante', { id: 20, permissions: ['GTPP_USE'] }],
        ['GTPP_MANAGE', { id: 99, permissions: ['GTPP_MANAGE'] }],
        ['SYSTEM_OWNER', { id: 99, permissions: ['SYSTEM_OWNER'] }],
    ])('should allow %s', async (_, user) => {
        const fakes = makeFakes();
        const result = await makeUseCases(fakes).generateDossier(5, user);
        expect(result).toEqual({ buffer: Buffer.from('%PDF'), fileName: 'dossie-tarefa-5.pdf' });
    });

    it('should ask the repository for the chat limit of the template', async () => {
        const fakes = makeFakes();
        await makeUseCases(fakes).generateDossier(5, { id: 10 });
        expect(fakes.repository.findDossierData).toHaveBeenCalledWith(5, { messageLimit: 200 });
    });

    it('should resolve scope names only when there is scope', async () => {
        const fakes = makeFakes();
        await makeUseCases(fakes).generateDossier(5, { id: 10 });
        expect(fakes.scopeNameResolver.resolve).not.toHaveBeenCalled();

        const withScope = makeFakes({ data: makeData({ scope: [{ company_code: '01', branch_code: null, cost_center_code: null }] }) });
        await makeUseCases(withScope).generateDossier(5, { id: 10 });
        const dossier = withScope.renderer.render.mock.calls[0][0];
        expect(dossier.scope).toEqual([{ company: '01 · EMPRESA', branch: 'Todas', cost_center: 'Todos' }]);
    });

    it('should hand the renderer a dossier with thumbnails and the viewer name', async () => {
        const fakes = makeFakes();
        await makeUseCases(fakes).generateDossier(5, { id: 20 });
        expect(fakes.thumbnailProvider.toDataUri).toHaveBeenCalledWith('a.webp', 320);
        const dossier = fakes.renderer.render.mock.calls[0][0];
        expect(dossier.items[0].attachment.thumb).toBe('data:image/jpeg;base64,AAA');
        expect(dossier.generated_by).toEqual({ id: 20, name: 'COLAB' });
        expect(dossier.generated_at).toBe('2026-10-20T14:32:00');
    });

    it('should keep going when a thumbnail is unavailable', async () => {
        const fakes = makeFakes();
        fakes.thumbnailProvider.toDataUri.mockResolvedValue(null);
        await makeUseCases(fakes).generateDossier(5, { id: 10 });
        expect(fakes.renderer.render.mock.calls[0][0].items[0].attachment.thumb).toBeNull();
    });

    it('should produce a dossier the template renders, escaping user text', async () => {
        const fakes = makeFakes({ data: makeData({ task: { ...makeData().task, title: '<script>x</script> & "a"' } }) });
        await makeUseCases(fakes).generateDossier(5, { id: 10 });
        const html = renderTaskDossierHtml(fakes.renderer.render.mock.calls[0][0]);
        expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;a&quot;');
        expect(html).not.toContain('<script>x</script>');
    });
});
