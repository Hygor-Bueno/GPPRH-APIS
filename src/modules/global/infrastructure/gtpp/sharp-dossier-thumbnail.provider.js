/**
 * @fileoverview Adapter `sharp` — implementa `DossierThumbnailPort`.
 *
 * Reduz a imagem armazenada para JPEG pequeno antes de embutir no PDF: as
 * evidências chegam em resolução de câmera e, embutidas cheias, um dossiê de
 * algumas dezenas de fotos passaria fácil de 50 MB.
 *
 * `sharp` é carregado sob demanda: o binário nativo só existe para o Linux do
 * container, e o carregamento no topo derrubaria quem importa este módulo
 * numa máquina de desenvolvimento Windows.
 *
 * @module modules/global/infrastructure/gtpp/sharp-dossier-thumbnail.provider
 */

const { DossierThumbnailPort } = require('../../application/gtpp/task-dossier/ports/dossier-thumbnail.port');
const { resolveStoragePath } = require('../../../../utils/file/storage-paths');

const JPEG_QUALITY = 70;

class SharpDossierThumbnailProvider extends DossierThumbnailPort {
    async toDataUri(filePath, maxSide) {
        try {
            const sharp = require('sharp');
            const buffer = await sharp(resolveStoragePath(filePath), { failOn: 'none' })
                .rotate() // respeita a orientação EXIF das fotos de celular
                .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
                .flatten({ background: '#ffffff' }) // PNG/WebP com transparência
                .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
                .toBuffer();
            return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        } catch (error) {
            console.warn(`[gtpp:dossier] Miniatura indisponível para ${filePath}: ${error.message}`);
            return null;
        }
    }
}

module.exports = { SharpDossierThumbnailProvider };
