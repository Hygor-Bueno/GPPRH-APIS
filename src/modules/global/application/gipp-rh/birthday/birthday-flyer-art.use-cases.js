/**
 * @fileoverview Arte do cartaz de aniversariantes por empresa — gestão (listar,
 * enviar, ajustar medidas, voltar à padrão) e a escolha da arte de cada slide.
 *
 * @module modules/global/application/gipp-rh/birthday/birthday-flyer-art.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const {
    FlyerArtErrorCode,
    DEFAULT_LAYOUT,
    normalizeCompanyCode,
    assertPosterProportion,
    scaleDefaultLayout,
    parseLayoutInput,
    resolveLayout,
    toFlyerArtEntry,
} = require('../../../domain/gipp-rh/birthday-flyer-art.rules');

/** Chave da arte padrão no mapa entregue ao renderer. */
const DEFAULT_ART_KEY = 'default';

/**
 * Arte de cada empresa pedida — a própria, ou a padrão.
 *
 * @param {{ artRepository: import('./ports/birthday-flyer-art-repository.port').BirthdayFlyerArtRepositoryPort,
 *           artStorage: import('./ports/birthday-flyer-art-storage.port').BirthdayFlyerArtStoragePort }} deps
 * @param {string[]} companyCodes
 * @returns {Promise<Map<string, { key: string, buffer: Buffer, width: number, height: number, layout: object }>>}
 */
async function resolveFlyerArts({ artRepository, artStorage }, companyCodes) {
    const custom = new Map((await artRepository.list()).map(art => [art.company_code, art]));
    let defaultArt = null;
    const loadDefault = async () => {
        if (!defaultArt) {
            const image = await artStorage.readDefaultPng();
            defaultArt = { key: DEFAULT_ART_KEY, ...image, layout: { ...DEFAULT_LAYOUT } };
        }
        return defaultArt;
    };

    const entries = await Promise.all([...new Set(companyCodes)].map(async code => {
        const art = custom.get(code);
        if (!art) return [code, await loadDefault()];
        const image = await artStorage.readPng(art.file_id);
        return [code, { key: code, ...image, layout: art.layout }];
    }));
    return new Map(entries);
}

class GippRhBirthdayFlyerArtUseCases {
    /**
     * @param {{ repository: import('./ports/birthday-repository.port').BirthdayRepositoryPort,
     *           artRepository: import('./ports/birthday-flyer-art-repository.port').BirthdayFlyerArtRepositoryPort,
     *           artStorage: import('./ports/birthday-flyer-art-storage.port').BirthdayFlyerArtStoragePort }} deps
     */
    constructor({ repository, artRepository, artStorage }) {
        this.repository = repository;
        this.artRepository = artRepository;
        this.artStorage = artStorage;
    }

    /** Todas as empresas do Protheus, com a arte de cada uma (própria ou padrão). */
    async list() {
        const [companies, arts] = await Promise.all([
            this.repository.findCompanies(),
            this.artRepository.list(),
        ]);
        const byCode = new Map(arts.map(art => [art.company_code, art]));
        return companies.map(company => toFlyerArtEntry(company, byCode.get(company.code) ?? null));
    }

    /**
     * Imagem que vai no cartaz da empresa, em PNG — para a tela mostrar e medir.
     *
     * @param {unknown} rawCompanyCode
     * @returns {Promise<{ buffer: Buffer, custom: boolean }>}
     */
    async getImage(rawCompanyCode) {
        const company = await this._company(rawCompanyCode);
        const art = await this.artRepository.findByCompany(company.code);
        const image = art
            ? await this.artStorage.readPng(art.file_id)
            : await this.artStorage.readDefaultPng();
        return { buffer: image.buffer, custom: Boolean(art) };
    }

    /**
     * Cria ou altera a arte da empresa.
     *
     * - Com imagem nova: as medidas partem do layout atual da empresa se a imagem
     *   tiver o mesmo tamanho da anterior (troca de arte do mesmo modelo); senão,
     *   do layout padrão escalado para a imagem.
     * - Sem imagem: só ajusta as medidas da arte que a empresa já tem.
     *
     * Medidas e proporção são conferidas ANTES de gravar o arquivo, para uma arte
     * recusada não deixar linha em `_files`.
     *
     * @param {unknown} rawCompanyCode
     * @param {?object} file - `req.file`.
     * @param {{ layout?: unknown }} body
     * @param {number} userId - `req.user.id`.
     */
    async save(rawCompanyCode, file, body, userId) {
        const company = await this._company(rawCompanyCode);
        const existing = await this.artRepository.findByCompany(company.code);
        const overrides = parseLayoutInput(body?.layout);

        let fileId;
        let size;
        let layout;
        if (file) {
            size = await this.artStorage.inspect(file);
            assertPosterProportion(size);
            const sameSize = existing && existing.image_width === size.width && existing.image_height === size.height;
            layout = resolveLayout(sameSize ? existing.layout : scaleDefaultLayout(size), overrides, size);
            ({ fileId } = await this.artStorage.save(file, userId));
        } else {
            if (!existing) {
                throw new AppError('Esta empresa usa a arte padrão. Envie a imagem da arte no campo `file`.', 400, {
                    code: FlyerArtErrorCode.FileRequired,
                });
            }
            size = { width: existing.image_width, height: existing.image_height };
            layout = resolveLayout(existing.layout, overrides, size);
            fileId = existing.file_id;
        }

        await this.artRepository.upsert({
            companyCode: company.code,
            fileId,
            imageWidth: size.width,
            imageHeight: size.height,
            layout,
            userId,
        });
        return toFlyerArtEntry(company, await this.artRepository.findByCompany(company.code));
    }

    /** A empresa volta para a arte padrão. */
    async remove(rawCompanyCode) {
        const companyCode = normalizeCompanyCode(rawCompanyCode);
        const removed = await this.artRepository.remove(companyCode);
        if (!removed) {
            throw new AppError('Esta empresa já usa a arte padrão.', 404, {
                code: FlyerArtErrorCode.ArtNotFound,
            });
        }
    }

    /** @private */
    async _company(rawCompanyCode) {
        const code = normalizeCompanyCode(rawCompanyCode);
        const company = (await this.repository.findCompanies()).find(c => c.code === code);
        if (!company) {
            throw new AppError(`Empresa ${code} não encontrada no Protheus.`, 404, {
                code: FlyerArtErrorCode.CompanyNotFound,
            });
        }
        return company;
    }
}

module.exports = { GippRhBirthdayFlyerArtUseCases, resolveFlyerArts, DEFAULT_ART_KEY };
