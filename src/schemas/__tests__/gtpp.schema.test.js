const { validateSchema } = require('../../middlewares/validate.middleware');
const {
    postTaskSchema,
    putTaskTitleSchema,
    putTaskDescriptionSchema,
    putTaskStateSchema,
    postTaskItemSchema,
    postThemeSchema,
} = require('../gtpp.schema');

describe('postTaskSchema', () => {
    it('exige o título (title), não a descrição longa', () => {
        expect(validateSchema({ title: 'Revisar contrato' }, postTaskSchema)).toHaveLength(0);
        expect(validateSchema({ description: 'só a descrição' }, postTaskSchema))
            .toContain("O campo 'title' é obrigatório.");
    });

    // gt_task.full_description é LONGTEXT — o antigo teto de 500 caracteres
    // barrava descrições que a coluna aceita sem problema.
    it('aceita descrição longa acima de 500 caracteres', () => {
        const errors = validateSchema(
            { title: 'Tarefa', description: 'a'.repeat(20000) },
            postTaskSchema
        );
        expect(errors).toHaveLength(0);
    });

    it('recusa título acima do limite da coluna (255)', () => {
        const errors = validateSchema({ title: 'a'.repeat(256) }, postTaskSchema);
        expect(errors).toContain("O campo 'title' deve ter no máximo 255 caracteres.");
    });
});

describe('putTaskTitleSchema', () => {
    it('recusa título acima de 255 caracteres', () => {
        expect(validateSchema({ description: 'a'.repeat(256) }, putTaskTitleSchema))
            .toContain("O campo 'description' deve ter no máximo 255 caracteres.");
    });
});

describe('putTaskDescriptionSchema', () => {
    it('aceita descrição longa em full_description e no alias legado description', () => {
        expect(validateSchema({ full_description: 'a'.repeat(20000) }, putTaskDescriptionSchema)).toHaveLength(0);
        expect(validateSchema({ description: 'a'.repeat(20000) }, putTaskDescriptionSchema)).toHaveLength(0);
    });
});

describe('putTaskStateSchema', () => {
    // gt_task_historic.description é LONGTEXT.
    it('aceita justificativa acima de 500 caracteres', () => {
        expect(validateSchema({ state_id: 2, description: 'a'.repeat(5000) }, putTaskStateSchema)).toHaveLength(0);
    });
});

describe('postTaskItemSchema', () => {
    it('alinha description (255) e note (10000) às colunas do banco', () => {
        expect(validateSchema({ description: 'a'.repeat(256) }, postTaskItemSchema))
            .toContain("O campo 'description' deve ter no máximo 255 caracteres.");
        expect(validateSchema({ description: 'item', note: 'a'.repeat(10000) }, postTaskItemSchema)).toHaveLength(0);
    });
});

describe('postThemeSchema', () => {
    it('recusa tema acima de 125 caracteres', () => {
        expect(validateSchema({ description_theme: 'a'.repeat(126) }, postThemeSchema))
            .toContain("O campo 'description_theme' deve ter no máximo 125 caracteres.");
    });
});
