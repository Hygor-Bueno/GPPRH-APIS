const { GippRhBirthdayUseCases } = require('../birthday.use-cases');
const { BirthdayRepositoryPort } = require('../ports/birthday-repository.port');
const { BirthdayFlyerRendererPort } = require('../ports/birthday-flyer-renderer.port');
const { BirthdayErrorCode } = require('../../../../domain/gipp-rh/birthday.rules');

function makeRepository(rows) {
    const repo = new BirthdayRepositoryPort();
    repo.findByMonth = jest.fn().mockResolvedValue(rows);
    return repo;
}

function makeRenderer() {
    const renderer = new BirthdayFlyerRendererPort();
    renderer.render = jest.fn().mockResolvedValue(Buffer.from('pptx'));
    return renderer;
}

const ROWS = [
    { branch_code: '0202', branch_name: 'PEG PESE INTERLAGOS', full_name: 'JOSE VIEIRA DA SILVA', birth_date: '19810324', cost_center: 'PADARIA' },
    { branch_code: '0202', branch_name: 'PEG PESE INTERLAGOS', full_name: 'ANA MARIA', birth_date: '19670303', cost_center: 'LOJA' },
];

describe('GippRhBirthdayUseCases', () => {
    it('valida o mês antes de ir ao banco', async () => {
        const repository = makeRepository(ROWS);
        const useCases = new GippRhBirthdayUseCases({ repository, flyerRenderer: makeRenderer() });

        await expect(useCases.listByMonth({ month: '13' }))
            .rejects.toMatchObject({ code: BirthdayErrorCode.InvalidMonth });
        expect(repository.findByMonth).not.toHaveBeenCalled();
    });

    it('repassa mês e filiais normalizados ao repositório', async () => {
        const repository = makeRepository(ROWS);
        const useCases = new GippRhBirthdayUseCases({ repository, flyerRenderer: makeRenderer() });

        const result = await useCases.listByMonth({ month: '3', branches: '0202,0206' });

        expect(repository.findByMonth).toHaveBeenCalledWith(3, ['0202', '0206']);
        expect(result.month_name).toBe('março');
        expect(result.branches[0].people.map(p => p.date)).toEqual(['03/03', '24/03']);
    });

    it('cartaz: manda os slides ao renderer e devolve nome de arquivo ASCII', async () => {
        const flyerRenderer = makeRenderer();
        const useCases = new GippRhBirthdayUseCases({ repository: makeRepository(ROWS), flyerRenderer });

        const { fileName, buffer } = await useCases.buildFlyer({ month: 3 });

        expect(fileName).toBe('aniversariantes-03-marco.pptx');
        expect(buffer).toEqual(Buffer.from('pptx'));
        const [flyer] = flyerRenderer.render.mock.calls[0];
        expect(flyer.monthName).toBe('março');
        expect(flyer.slides).toHaveLength(1);
        expect(flyer.slides[0].branchName).toBe('INTERLAGOS');
    });

    it('cartaz sem ninguém no mês → 404 com code próprio, sem chamar o renderer', async () => {
        const flyerRenderer = makeRenderer();
        const useCases = new GippRhBirthdayUseCases({ repository: makeRepository([]), flyerRenderer });

        await expect(useCases.buildFlyer({ month: 2 }))
            .rejects.toMatchObject({ statusCode: 404, code: BirthdayErrorCode.NoBirthdays });
        expect(flyerRenderer.render).not.toHaveBeenCalled();
    });
});
