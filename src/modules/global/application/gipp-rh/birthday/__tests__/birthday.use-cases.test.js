const { GippRhBirthdayUseCases } = require('../birthday.use-cases');
const { BirthdayRepositoryPort } = require('../ports/birthday-repository.port');
const { BirthdayExclusionRepositoryPort } = require('../ports/birthday-exclusion-repository.port');
const { BirthdayFlyerRendererPort } = require('../ports/birthday-flyer-renderer.port');
const { BirthdayErrorCode } = require('../../../../domain/gipp-rh/birthday.rules');

function makeRepository(rows, overrides = {}) {
    const repo = new BirthdayRepositoryPort();
    repo.findByMonth = jest.fn().mockResolvedValue(rows);
    repo.findEmployeeCpf = jest.fn().mockResolvedValue('12345678901');
    repo.findCurrentContractsByCpf = jest.fn().mockResolvedValue([]);
    return Object.assign(repo, overrides);
}

function makeExclusionRepository(overrides = {}) {
    const repo = new BirthdayExclusionRepositoryPort();
    repo.listCpfs = jest.fn().mockResolvedValue([]);
    repo.list = jest.fn().mockResolvedValue([]);
    repo.add = jest.fn().mockResolvedValue(9);
    repo.remove = jest.fn().mockResolvedValue(true);
    return Object.assign(repo, overrides);
}

function makeRenderer() {
    const renderer = new BirthdayFlyerRendererPort();
    renderer.render = jest.fn().mockResolvedValue(Buffer.from('pptx'));
    return renderer;
}

function makeUseCases({
    repository = makeRepository(ROWS),
    exclusionRepository = makeExclusionRepository(),
    flyerRenderer = makeRenderer(),
} = {}) {
    return new GippRhBirthdayUseCases({ repository, exclusionRepository, flyerRenderer });
}

const ROWS = [
    { branch_code: '0202', branch_name: 'PEG PESE INTERLAGOS', full_name: 'JOSE VIEIRA DA SILVA', cpf: '11111111111', birth_date: '19810324', cost_center: 'PADARIA' },
    { branch_code: '0202', branch_name: 'PEG PESE INTERLAGOS', full_name: 'ANA MARIA', cpf: '22222222222', birth_date: '19670303', cost_center: 'LOJA' },
];

describe('GippRhBirthdayUseCases', () => {
    it('valida o mês antes de ir ao banco', async () => {
        const repository = makeRepository(ROWS);
        const useCases = makeUseCases({ repository });

        await expect(useCases.listByMonth({ month: '13' }))
            .rejects.toMatchObject({ code: BirthdayErrorCode.InvalidMonth });
        expect(repository.findByMonth).not.toHaveBeenCalled();
    });

    it('repassa mês e filiais normalizados ao repositório', async () => {
        const repository = makeRepository(ROWS);
        const useCases = makeUseCases({ repository });

        const result = await useCases.listByMonth({ month: '3', branches: '0202,0206' });

        expect(repository.findByMonth).toHaveBeenCalledWith(3, ['0202', '0206']);
        expect(result.month_name).toBe('março');
        expect(result.branches[0].people.map(p => p.date)).toEqual(['03/03', '24/03']);
    });

    it('tira da lista quem tem o CPF na lista de exclusão', async () => {
        const exclusionRepository = makeExclusionRepository({ listCpfs: jest.fn().mockResolvedValue(['22222222222']) });
        const result = await makeUseCases({ exclusionRepository }).listByMonth({ month: 3 });

        expect(result.branches[0].people.map(p => p.name)).toEqual(['Jose Vieira da Silva']);
    });

    it('filial em que todos estão excluídos não aparece', async () => {
        const exclusionRepository = makeExclusionRepository({
            listCpfs: jest.fn().mockResolvedValue(['11111111111', '22222222222']),
        });
        const result = await makeUseCases({ exclusionRepository }).listByMonth({ month: 3 });

        expect(result.branches).toEqual([]);
    });

    it('cartaz: manda os slides ao renderer e devolve nome de arquivo ASCII', async () => {
        const flyerRenderer = makeRenderer();
        const useCases = makeUseCases({ flyerRenderer });

        const { fileName, buffer } = await useCases.buildFlyer({ month: 3 });

        expect(fileName).toBe('aniversariantes-03-marco.pptx');
        expect(buffer).toEqual(Buffer.from('pptx'));
        const [flyer] = flyerRenderer.render.mock.calls[0];
        expect(flyer.monthName).toBe('março');
        expect(flyer.slides).toHaveLength(1);
        expect(flyer.slides[0].branchName).toBe('INTERLAGOS');
    });

    it('cartaz sem os excluídos', async () => {
        const flyerRenderer = makeRenderer();
        const exclusionRepository = makeExclusionRepository({ listCpfs: jest.fn().mockResolvedValue(['11111111111']) });

        await makeUseCases({ flyerRenderer, exclusionRepository }).buildFlyer({ month: 3 });

        const [flyer] = flyerRenderer.render.mock.calls[0];
        expect(flyer.slides[0].people.map(p => p.name)).toEqual(['Ana Maria']);
    });

    it('cartaz sem ninguém no mês → 404 com code próprio, sem chamar o renderer', async () => {
        const flyerRenderer = makeRenderer();
        const useCases = makeUseCases({ repository: makeRepository([]), flyerRenderer });

        await expect(useCases.buildFlyer({ month: 2 }))
            .rejects.toMatchObject({ statusCode: 404, code: BirthdayErrorCode.NoBirthdays });
        expect(flyerRenderer.render).not.toHaveBeenCalled();
    });
});

describe('GippRhBirthdayUseCases — lista de exclusão', () => {
    it('resolve o CPF no Protheus pela filial + matrícula e grava com o usuário da sessão', async () => {
        const repository = makeRepository(ROWS);
        const exclusionRepository = makeExclusionRepository();
        const result = await makeUseCases({ repository, exclusionRepository })
            .addExclusion({ branch_code: '0202', registration: '2351', reason: 'Pediu' }, 42);

        expect(repository.findEmployeeCpf).toHaveBeenCalledWith('0202', '002351');
        expect(exclusionRepository.add).toHaveBeenCalledWith({ cpf: '12345678901', reason: 'Pediu', createdBy: 42 });
        expect(result).toEqual({ id: 9 });
    });

    it('ignora CPF vindo do body', async () => {
        const exclusionRepository = makeExclusionRepository();
        await makeUseCases({ exclusionRepository })
            .addExclusion({ branch_code: '0202', registration: '2351', cpf: '99999999999' }, 42);

        expect(exclusionRepository.add.mock.calls[0][0].cpf).toBe('12345678901');
    });

    it('matrícula fora do Protheus → 404, sem gravar', async () => {
        const repository = makeRepository(ROWS, { findEmployeeCpf: jest.fn().mockResolvedValue(null) });
        const exclusionRepository = makeExclusionRepository();

        await expect(makeUseCases({ repository, exclusionRepository }).addExclusion({ branch_code: '0202', registration: '1' }, 42))
            .rejects.toMatchObject({ statusCode: 404, code: BirthdayErrorCode.EmployeeNotFound });
        expect(exclusionRepository.add).not.toHaveBeenCalled();
    });

    it('lista junta cada exclusão ao contrato atual, por filial e nome; sem contrato vai para o fim', async () => {
        const exclusionRepository = makeExclusionRepository({
            list: jest.fn().mockResolvedValue([
                { id: 1, cpf: '11111111111', reason: null, created_at: 'x', created_by: 7 },
                { id: 2, cpf: '22222222222', reason: 'Pediu', created_at: 'y', created_by: 7 },
                { id: 3, cpf: '33333333333', reason: null, created_at: 'z', created_by: 7 },
            ]),
        });
        const repository = makeRepository(ROWS, {
            findCurrentContractsByCpf: jest.fn().mockResolvedValue([
                { cpf: '22222222222', branch_code: '0202', branch_name: 'PEG PESE INTERLAGOS', registration: '000002', full_name: 'BRUNO', cost_center: 'LOJA', dismissed: 0 },
                { cpf: '33333333333', branch_code: '0202', branch_name: 'PEG PESE INTERLAGOS', registration: '000003', full_name: 'ANA', cost_center: 'LOJA', dismissed: 1 },
            ]),
        });

        const result = await makeUseCases({ repository, exclusionRepository }).listExclusions();

        expect(repository.findCurrentContractsByCpf).toHaveBeenCalledWith(['11111111111', '22222222222', '33333333333']);
        expect(result.map(e => [e.id, e.name, e.dismissed])).toEqual([[3, 'Ana', true], [2, 'Bruno', false], [1, null, false]]);
        expect(result[0]).not.toHaveProperty('cpf');
    });

    it('remover id inexistente → 404 com code próprio', async () => {
        const exclusionRepository = makeExclusionRepository({ remove: jest.fn().mockResolvedValue(false) });

        await expect(makeUseCases({ exclusionRepository }).removeExclusion('5'))
            .rejects.toMatchObject({ statusCode: 404, code: BirthdayErrorCode.ExclusionNotFound });
        expect(exclusionRepository.remove).toHaveBeenCalledWith(5);
    });
});
