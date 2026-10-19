const { GippRhBirthdayUseCases } = require('../birthday.use-cases');
const { BirthdayRepositoryPort } = require('../ports/birthday-repository.port');
const { BirthdayExclusionRepositoryPort } = require('../ports/birthday-exclusion-repository.port');
const { BirthdayFlyerRendererPort } = require('../ports/birthday-flyer-renderer.port');
const { BirthdayFlyerArtRepositoryPort } = require('../ports/birthday-flyer-art-repository.port');
const { BirthdayFlyerArtStoragePort } = require('../ports/birthday-flyer-art-storage.port');
const { BirthdayErrorCode } = require('../../../../domain/gipp-rh/birthday.rules');
const { DEFAULT_LAYOUT } = require('../../../../domain/gipp-rh/birthday-flyer-art.rules');

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

function makeArtRepository(arts = []) {
    const repo = new BirthdayFlyerArtRepositoryPort();
    repo.list = jest.fn().mockResolvedValue(arts);
    return repo;
}

function makeArtStorage() {
    const storage = new BirthdayFlyerArtStoragePort();
    storage.readDefaultPng = jest.fn().mockResolvedValue({ buffer: Buffer.from('default'), width: 842, height: 1191 });
    storage.readPng = jest.fn().mockImplementation(async fileId => ({ buffer: Buffer.from(`file-${fileId}`), width: 1684, height: 2382 }));
    return storage;
}

function makeUseCases({
    repository = makeRepository(ROWS),
    exclusionRepository = makeExclusionRepository(),
    artRepository = makeArtRepository(),
    artStorage = makeArtStorage(),
    flyerRenderer = makeRenderer(),
} = {}) {
    return new GippRhBirthdayUseCases({ repository, exclusionRepository, artRepository, artStorage, flyerRenderer });
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

    it('cartaz: empresa sem arte própria usa a padrão, uma vez só', async () => {
        const flyerRenderer = makeRenderer();
        const artStorage = makeArtStorage();
        const rows = [...ROWS, { ...ROWS[0], branch_code: '0206', branch_name: 'PEG PESE BOLONHA', cpf: '3' }];

        await makeUseCases({ repository: makeRepository(rows), flyerRenderer, artStorage }).buildFlyer({ month: 3 });

        const [flyer] = flyerRenderer.render.mock.calls[0];
        expect(Object.keys(flyer.arts)).toEqual(['default']);
        expect(flyer.arts.default.layout).toEqual(DEFAULT_LAYOUT);
        expect(flyer.slides.map(s => s.artKey)).toEqual(['default', 'default']);
        expect(artStorage.readDefaultPng).toHaveBeenCalledTimes(1);
        expect(artStorage.readPng).not.toHaveBeenCalled();
    });

    it('cartaz com mescla: um slide para as duas filiais, e o filtro ganha a filial mesclada', async () => {
        const flyerRenderer = makeRenderer();
        const rows = [...ROWS, { ...ROWS[0], branch_code: '0209', branch_name: 'PEG PESE ESCRITORIO CENTRAL', full_name: 'EVA', cpf: '3' }];
        const repository = makeRepository(rows);

        await makeUseCases({ repository, flyerRenderer }).buildFlyer({ month: 3, branches: '0202', merge: '0202,0209' });

        expect(repository.findByMonth).toHaveBeenCalledWith(3, ['0202', '0209']);
        const [flyer] = flyerRenderer.render.mock.calls[0];
        expect(flyer.slides).toHaveLength(1);
        expect(flyer.slides[0]).toMatchObject({ branchCode: '0202', branchName: 'INTERLAGOS' });
        expect(flyer.slides[0].people.map(p => p.name)).toEqual(['Ana Maria', 'Eva', 'Jose Vieira da Silva']);
    });

    it('mescla inválida é recusada antes de ir ao banco', async () => {
        const repository = makeRepository(ROWS);

        await expect(makeUseCases({ repository }).buildFlyer({ month: 3, merge: '0202' }))
            .rejects.toMatchObject({ code: BirthdayErrorCode.InvalidMerge });
        expect(repository.findByMonth).not.toHaveBeenCalled();
    });

    it('a lista da tela não é afetada pela mescla', async () => {
        const rows = [...ROWS, { ...ROWS[0], branch_code: '0209', branch_name: 'PEG PESE ESCRITORIO CENTRAL', cpf: '3' }];
        const result = await makeUseCases({ repository: makeRepository(rows) }).listByMonth({ month: 3, merge: '0202,0209' });

        expect(result.branches.map(b => b.branchCode)).toEqual(['0202', '0209']);
    });

    it('cartaz: cada filial sai com a arte da sua empresa e as linhas dela', async () => {
        const flyerRenderer = makeRenderer();
        const frugalLayout = { ...DEFAULT_LAYOUT, rows_per_slide: 1 };
        const artRepository = makeArtRepository([
            { company_code: '01', file_id: 77, image_width: 1684, image_height: 2382, layout: frugalLayout },
        ]);
        const rows = [
            ...ROWS,
            { ...ROWS[0], branch_code: '0102', branch_name: 'FRUGAL BOLONHA', cpf: '3' },
            { ...ROWS[1], branch_code: '0102', branch_name: 'FRUGAL BOLONHA', cpf: '4' },
        ];

        await makeUseCases({ repository: makeRepository(rows), artRepository, flyerRenderer }).buildFlyer({ month: 3 });

        const [flyer] = flyerRenderer.render.mock.calls[0];
        expect(flyer.slides.map(s => [s.branchCode, s.artKey, s.page, s.people.length])).toEqual([
            ['0102', '01', 1, 1],
            ['0102', '01', 2, 1],
            ['0202', 'default', 1, 2],
        ]);
        expect(flyer.arts['01']).toMatchObject({ buffer: Buffer.from('file-77'), width: 1684, layout: frugalLayout });
        expect(Object.keys(flyer.arts).sort()).toEqual(['01', 'default']);
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
