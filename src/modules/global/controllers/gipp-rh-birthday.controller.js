/**
 * @fileoverview Controller dos aniversariantes do mês (GIPP-RH).
 *
 * Só sai dia e mês do nascimento: `toBirthdayEntry` descarta o ano (e a
 * matrícula), já que o cartaz é feito para ser afixado na loja.
 *
 * @module modules/global/controllers/gipp-rh-birthday.controller
 */

const { GippRhBirthdayUseCases } = require('../application/gipp-rh/birthday/birthday.use-cases');
const { SqlServerBirthdayRepository } = require('../infrastructure/gipp-rh/sqlserver-birthday.repository');
const { PptxBirthdayFlyerRenderer } = require('../infrastructure/gipp-rh/pptx-birthday-flyer.renderer');
const { respond } = require('../../../utils/respond');

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const useCases = new GippRhBirthdayUseCases({
    repository: new SqlServerBirthdayRepository(),
    flyerRenderer: new PptxBirthdayFlyerRenderer(),
});

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

module.exports = { getBirthdays, downloadBirthdayFlyer };
