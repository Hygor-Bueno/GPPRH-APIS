/**
 * @fileoverview Controller do Dossiê da tarefa GTPP (download em PDF).
 * @module modules/global/controllers/gtpp-task-dossier.controller
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { AppError } = require('../../../errors/app.error');
const { ProtheusUseCases } = require('../../protheus/application/protheus.use-cases');
const { SqlServerProtheusRepository } = require('../../protheus/infrastructure/sqlserver-protheus.repository');
const { GtppTaskDossierUseCases } = require('../application/gtpp/task-dossier/gtpp-task-dossier.use-cases');
const { GtppDossierErrorCode } = require('../domain/gtpp/task-dossier/task-dossier.enums');
const { MysqlTaskDossierRepository } = require('../infrastructure/gtpp/mysql-task-dossier.repository');
const { SharpDossierThumbnailProvider } = require('../infrastructure/gtpp/sharp-dossier-thumbnail.provider');
const { PuppeteerTaskDossierRenderer } = require('../infrastructure/gtpp/puppeteer-task-dossier.renderer');
const { ProtheusGtppScopeNameResolver } = require('../infrastructure/gtpp/protheus-gtpp-scope-name.resolver');

/**
 * Logo do recibo, reaproveitado. O SVG só embrulha um PNG; o PNG puro sai
 * menor no cabeçalho, que o Chromium repete em toda página.
 */
function loadBrandLogo() {
    try {
        const svg = fs.readFileSync(path.join(__dirname, '../../../templates/receipt/gpp-logo-identical.svg'), 'utf8');
        const match = /href="(data:image\/png;base64,[^"]+)"/.exec(svg);
        return match ? match[1].replace(/\s+/g, '') : null;
    } catch {
        return null;
    }
}

const useCases = new GtppTaskDossierUseCases({
    repository: new MysqlTaskDossierRepository(),
    thumbnailProvider: new SharpDossierThumbnailProvider(),
    renderer: new PuppeteerTaskDossierRenderer(),
    scopeNameResolver: new ProtheusGtppScopeNameResolver({
        protheusUseCases: new ProtheusUseCases({ repository: new SqlServerProtheusRepository() }),
    }),
    brand: { name: 'Peg Pesé', logo: loadBrandLogo() },
    // Os links do PDF abrem a tarefa no front (com login), nunca o arquivo direto.
    webBaseUrl: process.env.GTPP_WEB_BASE_URL,
});

/**
 * GET /gtpp/tasks/:id/dossier
 * Gera o PDF "Dossiê da tarefa" e devolve como download.
 */
async function downloadTaskDossier(req, res) {
    const taskId = parseInt(req.params.id, 10);
    if (!Number.isInteger(taskId) || taskId <= 0) {
        throw new AppError('Tarefa inválida.', 400, { code: GtppDossierErrorCode.TASK_NOT_FOUND });
    }

    const { buffer, fileName } = await useCases.generateDossier(taskId, req.user);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return res.send(buffer);
}

module.exports = { downloadTaskDossier };
