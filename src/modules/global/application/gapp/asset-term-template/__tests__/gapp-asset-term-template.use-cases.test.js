const { GappAssetTermTemplateUseCases } = require('../gapp-asset-term-template.use-cases');

const TEMPLATE = {
    asset_term_template_id: 3, name: 'Termo de smartphone', asset_type: 'smartphone',
    content: '# TERMO\nNOME: @nome@\nIMEI: @imei@', status_template: 1,
};

function makeDeps(overrides = {}) {
    const repository = {
        list: jest.fn().mockResolvedValue([TEMPLATE]),
        findById: jest.fn().mockResolvedValue(TEMPLATE),
        nameExists: jest.fn().mockResolvedValue(false),
        insert: jest.fn().mockResolvedValue({ insertId: 3 }),
        update: jest.fn().mockResolvedValue({ updated: 1 }),
        ...overrides,
    };
    return { repository, useCases: new GappAssetTermTemplateUseCases({ repository }) };
}

describe('GappAssetTermTemplateUseCases', () => {
    test('catálogo traz os tipos de ativo e os grupos de campos', () => {
        const { useCases } = makeDeps();
        const fields = useCases.getFields();
        expect(fields.asset_types.map(type => type.value)).toEqual(['generic', 'vehicle', 'smartphone', 'sim']);
        expect(fields.groups.find(group => group.group === 'Smartphone').fields.map(field => field.key)).toContain('imei');
    });

    test('molde inexistente: 404', async () => {
        const { useCases } = makeDeps({ findById: jest.fn().mockResolvedValue(null) });
        await expect(useCases.getTemplateById(9)).rejects.toMatchObject({ statusCode: 404 });
    });

    describe('createTemplate', () => {
        test('grava normalizado, disponível por padrão e com o usuário', async () => {
            const { useCases, repository } = makeDeps();
            await useCases.createTemplate({ name: '  Termo  ', asset_type: 'smartphone', content: 'A @imei@\r\nB' }, 7);
            expect(repository.insert).toHaveBeenCalledWith({
                name: 'Termo', asset_type: 'smartphone', content: 'A @imei@\nB', status_template: 1, user_id: 7,
            });
        });

        test('campo de outro tipo de ativo é recusado com a lista', async () => {
            const { useCases, repository } = makeDeps();
            await expect(useCases.createTemplate({ name: 'X', asset_type: 'vehicle', content: 'IMEI: @imei@ @inexistente@' }, 7))
                .rejects.toMatchObject({ statusCode: 400, code: 'GAPP_ASSET_TERM_TEMPLATE_UNKNOWN_FIELDS', details: ['imei', 'inexistente'] });
            expect(repository.insert).not.toHaveBeenCalled();
        });

        test('campos comuns valem para qualquer tipo', async () => {
            const { useCases, repository } = makeDeps();
            await useCases.createTemplate({ name: 'X', asset_type: 'generic', content: '@nome@ @patrimonio@ @data@' }, 7);
            expect(repository.insert).toHaveBeenCalled();
        });

        test('tipo inválido e conteúdo vazio: 400', async () => {
            const { useCases } = makeDeps();
            await expect(useCases.createTemplate({ name: 'X', asset_type: 'barco', content: 'a' }, 7)).rejects.toMatchObject({ statusCode: 400 });
            await expect(useCases.createTemplate({ name: 'X', asset_type: 'sim', content: '   ' }, 7)).rejects.toMatchObject({ statusCode: 400 });
        });

        test('nome repetido no mesmo tipo: 409', async () => {
            const { useCases } = makeDeps({ nameExists: jest.fn().mockResolvedValue(true) });
            await expect(useCases.createTemplate({ name: 'X', asset_type: 'sim', content: '@numero@' }, 7))
                .rejects.toMatchObject({ statusCode: 409 });
        });
    });

    describe('updateTemplate', () => {
        test('só o status: mantém o resto e confere o nome ignorando o próprio molde', async () => {
            const { useCases, repository } = makeDeps();
            await useCases.updateTemplate(3, { status_template: 0 }, 9);
            expect(repository.nameExists).toHaveBeenCalledWith('Termo de smartphone', 'smartphone', 3);
            expect(repository.update).toHaveBeenCalledWith(3, {
                name: 'Termo de smartphone', asset_type: 'smartphone', content: TEMPLATE.content, status_template: 0, user_id: 9,
            });
        });

        test('trocar o tipo revalida os campos do conteúdo atual', async () => {
            const { useCases, repository } = makeDeps();
            await expect(useCases.updateTemplate(3, { asset_type: 'vehicle' }, 9)).rejects.toMatchObject({ statusCode: 400 });
            expect(repository.update).not.toHaveBeenCalled();
        });
    });
});
