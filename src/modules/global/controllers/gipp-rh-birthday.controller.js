/**
 * @fileoverview Controller dos aniversariantes do mês (GIPP-RH).
 *
 * Só sai dia e mês do nascimento: `toBirthdayEntry` descarta o ano, já que o
 * cartaz é feito para ser afixado na loja. A matrícula vai no JSON (a tela
 * precisa dela para tirar alguém do cartaz), mas não é impressa.
 *
 * @module modules/global/controllers/gipp-rh-birthday.controller
 */

const { GippRhBirthdayUseCases } = require('../application/gipp-rh/birthday/birthday.use-cases');
const { GippRhBirthdayFlyerArtUseCases } = require('../application/gipp-rh/birthday/birthday-flyer-art.use-cases');
const { SqlServerBirthdayRepository } = require('../infrastructure/gipp-rh/sqlserver-birthday.repository');
const { MySqlBirthdayExclusionRepository } = require('../infrastructure/gipp-rh/mysql-birthday-exclusion.repository');
const { MySqlBirthdayFlyerArtRepository } = require('../infrastructure/gipp-rh/mysql-birthday-flyer-art.repository');
const { BirthdayFlyerArtStorage } = require('../infrastructure/gipp-rh/birthday-flyer-art.storage');
const { PptxBirthdayFlyerRenderer } = require('../infrastructure/gipp-rh/pptx-birthday-flyer.renderer');
const { respond } = require('../../../utils/respond');

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const repository = new SqlServerBirthdayRepository();
const artRepository = new MySqlBirthdayFlyerArtRepository();
const artStorage = new BirthdayFlyerArtStorage();

const useCases = new GippRhBirthdayUseCases({
    repository,
    exclusionRepository: new MySqlBirthdayExclusionRepository(),
    artRepository,
    artStorage,
    flyerRenderer: new PptxBirthdayFlyerRenderer(),
});

const artUseCases = new GippRhBirthdayFlyerArtUseCases({ repository, artRepository, artStorage });

/**
 * Aniversariantes do mês agrupados por filial, em ordem de dia.
 * @route GET /gipp-rh/birthdays?month=10[&branches=0202,0206]
 */
async function getBirthdays(req, res) {
    const data = await useCases.listByMonth(req.query);
    return respond.ok(res, data);
}

/**
 * Cartaz `.pptx` no layout do RH: um slide por filial (19 nomes por slide).
 * @route GET /gipp-rh/birthdays/flyer?month=10[&branches=0202,0206]
 */
async function downloadBirthdayFlyer(req, res) {
    const { fileName, buffer } = await useCases.buildFlyer(req.query);
    res.setHeader('Content-Type', PPTX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return res.send(buffer);
}

/**
 * Quem está fora do cartaz, com o contrato atual de cada um.
 * @route GET /gipp-rh/birthdays/exclusions
 */
async function getBirthdayExclusions(req, res) {
    const data = await useCases.listExclusions();
    return respond.ok(res, data);
}

/**
 * Tira alguém do cartaz (todos os meses).
 * @route POST /gipp-rh/birthdays/exclusions  { branch_code, registration, reason? }
 */
async function addBirthdayExclusion(req, res) {
    const data = await useCases.addExclusion(req.body, req.user.id);
    return respond.created(res, data);
}

/**
 * Devolve a pessoa ao cartaz.
 * @route DELETE /gipp-rh/birthdays/exclusions/:id
 */
async function removeBirthdayExclusion(req, res) {
    await useCases.removeExclusion(req.params.id);
    return respond.message(res, 'Colaborador de volta ao cartaz.');
}

/**
 * Empresas do Protheus com a arte do cartaz de cada uma (própria ou padrão).
 * @route GET /gipp-rh/birthdays/flyer-arts
 */
async function getFlyerArts(req, res) {
    const data = await artUseCases.list();
    return respond.ok(res, data);
}

/**
 * Imagem (PNG) da arte que sai no cartaz da empresa — para a tela exibir e medir.
 * @route GET /gipp-rh/birthdays/flyer-arts/:companyCode/image
 */
async function getFlyerArtImage(req, res) {
    const { buffer } = await artUseCases.getImage(req.params.companyCode);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
}

/**
 * Envia ou ajusta a arte da empresa. Multipart: imagem em `file` (opcional se a
 * empresa já tem arte) e medidas em `layout` (JSON, opcional).
 * @route PUT /gipp-rh/birthdays/flyer-arts/:companyCode
 */
async function saveFlyerArt(req, res) {
    const data = await artUseCases.save(req.params.companyCode, req.file ?? null, req.body ?? {}, req.user.id);
    return respond.ok(res, data);
}

/**
 * A empresa volta para a arte padrão.
 * @route DELETE /gipp-rh/birthdays/flyer-arts/:companyCode
 */
async function removeFlyerArt(req, res) {
    await artUseCases.remove(req.params.companyCode);
    return respond.message(res, 'A empresa voltou para a arte padrão.');
}

module.exports = {
    getBirthdays,
    downloadBirthdayFlyer,
    getBirthdayExclusions,
    addBirthdayExclusion,
    removeBirthdayExclusion,
    getFlyerArts,
    getFlyerArtImage,
    saveFlyerArt,
    removeFlyerArt,
};
