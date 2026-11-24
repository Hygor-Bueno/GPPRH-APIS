/**
 * @fileoverview Casos de uso — relatório da auditoria de ativos em PDF (GAPP).
 *
 * Mesmo fluxo do dossiê do GTPP: monta o HTML (`templates/gapp-audit`) e o
 * renderizador Puppeteer devolve o PDF para download/impressão. Os dados são
 * os do detalhe — `getAuditById` e `getReview` —, então o acesso é o mesmo:
 * auditoria do grupo de trabalho do usuário (404 fora dele).
 *
 * @module modules/global/application/gapp/active-audit/gapp-active-audit-report.use-cases
 */

'use strict';

const {
    renderAuditReportHtml, buildAuditReportHeader, buildAuditReportFooter,
} = require('../../../../../templates/gapp-audit/audit-report.template');

class GappActiveAuditReportUseCases {
    /**
     * @param {Object} deps
     * @param {import('./gapp-active-audit.use-cases').GappActiveAuditUseCases} deps.auditUseCases
     * @param {import('./ports/active-audit-repository.port').ActiveAuditRepositoryPort} deps.repository
     * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
     * @param {{ renderPdf: (input: object) => Promise<Buffer> }} deps.renderer
     * @param {() => Date} [deps.now]
     */
    constructor({ auditUseCases, repository, userRepository, renderer, now = () => new Date() }) {
        this.auditUseCases = auditUseCases;
        this.repository = repository;
        this.userRepository = userRepository;
        this.renderer = renderer;
        this.now = now;
    }

    /**
     * @returns {Promise<{ buffer: Buffer, fileName: string }>}
     * @throws {AppError} 404 auditoria fora do grupo / 503 fila de geração cheia
     */
    async generateReport(auditId, currentUser) {
        const [audit, review, generatedByName] = await Promise.all([
            this.auditUseCases.getAuditById(auditId, currentUser),
            this.auditUseCases.getReview(auditId, currentUser),
            this._viewerName(currentUser),
        ]);
        const buffer = await this.renderer.renderPdf({
            html: renderAuditReportHtml({ audit, review }),
            headerTemplate: buildAuditReportHeader({ auditId: audit.audit_id }),
            footerTemplate: buildAuditReportFooter({ generatedAt: this.now(), generatedByName }),
        });
        return { buffer, fileName: `relatorio-auditoria-${audit.audit_id}.pdf` };
    }

    /** @private Nome de quem gerou, para o rodapé (o token não traz o nome do GAPP). */
    async _viewerName(currentUser) {
        const gappUser = await this.userRepository.findAuthByAccessCode(currentUser?.id);
        if (!gappUser) return null;
        const [row] = await this.repository.findUserNames([gappUser.user_id]);
        return row?.name ?? null;
    }
}

module.exports = { GappActiveAuditReportUseCases };
