const { GippRhBirthdayFlyerArtUseCases } = require('../birthday-flyer-art.use-cases');
const { BirthdayRepositoryPort } = require('../ports/birthday-repository.port');
const { BirthdayFlyerArtRepositoryPort } = require('../ports/birthday-flyer-art-repository.port');
const { BirthdayFlyerArtStoragePort } = require('../ports/birthday-flyer-art-storage.port');
const { FlyerArtErrorCode, DEFAULT_LAYOUT } = require('../../../../domain/gipp-rh/birthday-flyer-art.rules');

const COMPANIES = [
    { code: '01', name: 'FRUGAL IMPORTADORA' },
    { code: '02', name: 'PEG PESE SUPERMERCADOS' },
];

const FILE = { path: '/tmp/arte.png', size: 10 };

function setup({ existing = null, size = { width: 1684, height: 2382 } } = {}) {
    const repository = new BirthdayRepositoryPort();
    repository.findCompanies = jest.fn().mockResolvedValue(COMPANIES);

    const stored = { current: existing };
    const artRepository = new BirthdayFlyerArtRepositoryPort();
    artRepository.list = jest.fn().mockImplementation(async () => (stored.current ? [stored.current] : []));
    artRepository.findByCompany = jest.fn().mockImplementation(async code =>
        (stored.current?.company_code === code ? stored.current : null));
    artRepository.upsert = jest.fn().mockImplementation(async art => {
        stored.current = {
            company_code: art.companyCode, file_id: art.fileId, image_width: art.imageWidth,
            image_height: art.imageHeight, layout: art.layout, updated_at: 'agora', updated_by: art.userId,
        };
    });
    artRepository.remove = jest.fn().mockResolvedValue(true);

    const artStorage = new BirthdayFlyerArtStoragePort();
    artStorage.inspect = jest.fn().mockResolvedValue(size);
    artStorage.save = jest.fn().mockResolvedValue({ fileId: 50 });
    artStorage.readPng = jest.fn().mockResolvedValue({ buffer: Buffer.from('custom'), width: 1684, height: 2382 });
    artStorage.readDefaultPng = jest.fn().mockResolvedValue({ buffer: Buffer.from('default'), width: 842, height: 1191 });

    const useCases = new GippRhBirthdayFlyerArtUseCases({ repository, artRepository, artStorage });
    return { useCases, repository, artRepository, artStorage };
}

describe('GippRhBirthdayFlyerArtUseCases', () => {
    it('lista todas as empresas, com a arte própria ou a padrão', async () => {
        const { useCases } = setup({
            existing: { company_code: '01', file_id: 9, image_width: 1684, image_height: 2382, layout: { a: 1 }, updated_at: 'd', updated_by: 7 },
        });

        const list = await useCases.list();

        expect(list.map(a => [a.companyCode, a.custom])).toEqual([['01', true], ['02', false]]);
        expect(list[1].layout).toEqual(DEFAULT_LAYOUT);
    });

    it('primeira arte: confere a imagem, escala o layout padrão e grava com o usuário', async () => {
        const { useCases, artStorage, artRepository } = setup();

        const entry = await useCases.save('02', FILE, {}, 42);

        expect(artStorage.inspect).toHaveBeenCalledWith(FILE);
        expect(artStorage.save).toHaveBeenCalledWith(FILE, 42);
        expect(artRepository.upsert.mock.calls[0][0]).toMatchObject({
            companyCode: '02', fileId: 50, imageWidth: 1684, imageHeight: 2382, userId: 42,
        });
        expect(entry.layout.first_row_top_px).toBe(DEFAULT_LAYOUT.first_row_top_px * 2);
        expect(entry.custom).toBe(true);
    });

    it('arte fora da proporção é recusada antes de gravar o arquivo', async () => {
        const { useCases, artStorage } = setup({ size: { width: 1000, height: 1000 } });

        await expect(useCases.save('02', FILE, {}, 42))
            .rejects.toMatchObject({ code: FlyerArtErrorCode.InvalidProportion });
        expect(artStorage.save).not.toHaveBeenCalled();
    });

    it('layout inválido é recusado antes de gravar o arquivo', async () => {
        const { useCases, artStorage } = setup();

        await expect(useCases.save('02', FILE, { layout: '{"rows_per_slide":0}' }, 42))
            .rejects.toMatchObject({ code: FlyerArtErrorCode.InvalidLayout });
        expect(artStorage.save).not.toHaveBeenCalled();
    });

    it('troca de imagem do mesmo tamanho mantém as medidas já ajustadas', async () => {
        const adjusted = { ...DEFAULT_LAYOUT, rows_per_slide: 15 };
        const { useCases, artRepository } = setup({
            existing: { company_code: '02', file_id: 9, image_width: 842, image_height: 1191, layout: adjusted },
            size: { width: 842, height: 1191 },
        });

        await useCases.save('02', FILE, {}, 42);

        expect(artRepository.upsert.mock.calls[0][0].layout.rows_per_slide).toBe(15);
    });

    it('sem imagem, ajusta só as medidas da arte que já existe', async () => {
        const { useCases, artStorage, artRepository } = setup({
            existing: { company_code: '02', file_id: 9, image_width: 842, image_height: 1191, layout: DEFAULT_LAYOUT },
        });

        await useCases.save('02', null, { layout: { accent_color: '#112233' } }, 42);

        expect(artStorage.save).not.toHaveBeenCalled();
        expect(artRepository.upsert.mock.calls[0][0]).toMatchObject({ fileId: 9, layout: { accent_color: '112233' } });
    });

    it('sem imagem e sem arte própria → 400 pedindo o arquivo', async () => {
        const { useCases } = setup();

        await expect(useCases.save('02', null, { layout: { rows_per_slide: 15 } }, 42))
            .rejects.toMatchObject({ statusCode: 400, code: FlyerArtErrorCode.FileRequired });
    });

    it('empresa que não existe no Protheus → 404', async () => {
        const { useCases, artStorage } = setup();

        await expect(useCases.save('55', FILE, {}, 42))
            .rejects.toMatchObject({ statusCode: 404, code: FlyerArtErrorCode.CompanyNotFound });
        expect(artStorage.inspect).not.toHaveBeenCalled();
    });

    it('imagem: a própria quando existe, senão a padrão', async () => {
        const { useCases } = setup({
            existing: { company_code: '01', file_id: 9, image_width: 1684, image_height: 2382, layout: DEFAULT_LAYOUT },
        });

        expect(await useCases.getImage('01')).toEqual({ buffer: Buffer.from('custom'), custom: true });
        expect(await useCases.getImage('02')).toEqual({ buffer: Buffer.from('default'), custom: false });
    });

    it('voltar à padrão quando já estava nela → 404', async () => {
        const { useCases, artRepository } = setup();
        artRepository.remove.mockResolvedValue(false);

        await expect(useCases.remove('02'))
            .rejects.toMatchObject({ statusCode: 404, code: FlyerArtErrorCode.ArtNotFound });
    });
});
