/**
 * @fileoverview Porta (contrato) — miniaturas de imagem para o dossiê (GTPP).
 * @module modules/global/application/gtpp/task-dossier/ports/dossier-thumbnail.port
 */

class DossierThumbnailPort {
    /**
     * Lê a imagem armazenada e devolve uma miniatura pronta para embutir.
     * Nunca lança: arquivo ausente ou ilegível devolve `null` (o template
     * mostra "Miniatura indisponível").
     *
     * @param {string} filePath - `_files.file_path`.
     * @param {number} maxSide  - lado maior em px.
     * @returns {Promise<string|null>} data URI `data:image/jpeg;base64,...`
     */
    toDataUri(filePath, maxSide) { throw new Error('Not implemented'); }
}

module.exports = { DossierThumbnailPort };
