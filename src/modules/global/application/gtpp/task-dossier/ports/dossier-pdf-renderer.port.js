/**
 * @fileoverview Porta (contrato) — renderização do dossiê em PDF (GTPP).
 * @module modules/global/application/gtpp/task-dossier/ports/dossier-pdf-renderer.port
 */

class DossierPdfRendererPort {
    /**
     * @param {object} dossier - contrato do template `renderTaskDossierHtml`.
     * @returns {Promise<Buffer>}
     * @throws {AppError} 503 (`GTPP_DOSSIER_BUSY`) quando a fila de geração está cheia.
     */
    render(dossier) { throw new Error('Not implemented'); }
}

module.exports = { DossierPdfRendererPort };
