/**
 * @fileoverview Casos de uso — Task Dossier GTPP (PDF "Dossiê da tarefa").
 *
 * Fluxo: lê a tarefa inteira → confere acesso → resolve nomes de escopo e
 * miniaturas → monta o contrato (`task-dossier.shaper`) → renderiza o PDF.
 *
 * Acesso: criador, participante ou administrador (`GTPP_MANAGE`/`SYSTEM_OWNER`).
 * O dossiê junta a tarefa inteira num arquivo que sai do sistema, então não
 * basta ter `GTPP_USE`.
 *
 * @module modules/global/application/gtpp/task-dossier/gtpp-task-dossier.use-cases
 */

'use strict';

const { AppError } = require('../../../../../errors/app.error');
const { assertAnyOwnerOrAdmin } = require('../../../domain/gtpp/task/task-ownership.guard');
const { GtppDossierErrorCode, DossierThumbSize } = require('../../../domain/gtpp/task-dossier/task-dossier.enums');
const {
    buildTaskDossier, listEvidenceThumbSources, listAvatarThumbSources,
} = require('../../../domain/gtpp/task-dossier/task-dossier.shaper');
const { buildDossierLinks } = require('../../../domain/gtpp/task-dossier/task-dossier-links');
const { LIMITS } = require('../../../../../templates/gtpp-dossier/task-dossier.template');

/** Miniaturas geradas ao mesmo tempo — cada uma decodifica uma imagem inteira. */
const THUMB_CONCURRENCY = 4;

class GtppTaskDossierUseCases {
    /**
     * @param {{
     *   repository: import('./ports/task-dossier-repository.port').TaskDossierRepositoryPort,
     *   thumbnailProvider: import('./ports/dossier-thumbnail.port').DossierThumbnailPort,
     *   renderer: import('./ports/dossier-pdf-renderer.port').DossierPdfRendererPort,
     *   scopeNameResolver: import('../ports/gtpp-scope-name-resolver.port').GtppScopeNameResolverPort,
     *   brand?: {name: string, logo: string|null},
     *   webBaseUrl?: string|null, // origem do front; sem ela o PDF sai sem links
     *   now?: () => Date,
     * }} deps
     */
    constructor({ repository, thumbnailProvider, renderer, scopeNameResolver, brand = null, webBaseUrl = null, now = () => new Date() }) {
        this.repository = repository;
        this.thumbnailProvider = thumbnailProvider;
        this.renderer = renderer;
        this.scopeNameResolver = scopeNameResolver;
        this.brand = brand;
        this.links = buildDossierLinks(webBaseUrl);
        this.now = now;
    }

    /**
     * @param {number} taskId
     * @param {{id: number, permissions?: string[]}} currentUser
     * @returns {Promise<{buffer: Buffer, fileName: string}>}
     * @throws {AppError} 404 tarefa inexistente / 403 sem acesso
     */
    async generateDossier(taskId, currentUser) {
        const data = await this.repository.findDossierData(taskId, { messageLimit: LIMITS.CHAT_MAX_MESSAGES });
        if (!data) {
            throw new AppError('Tarefa não encontrada.', 404, { code: GtppDossierErrorCode.TASK_NOT_FOUND });
        }

        assertAnyOwnerOrAdmin({
            currentUserId: currentUser?.id,
            ownerIds: [Number(data.task.creator_id), ...data.participants.map(p => Number(p.id))],
            permissions: Array.isArray(currentUser?.permissions) ? currentUser.permissions : [],
            message: 'Apenas participantes da tarefa ou um administrador podem gerar o dossiê.',
            code: GtppDossierErrorCode.FORBIDDEN,
        });

        const [viewer, scope, thumbs] = await Promise.all([
            this.repository.findViewer(currentUser.id),
            data.scope.length ? this.scopeNameResolver.resolve(data.scope) : [],
            this._buildThumbs(data),
        ]);

        const dossier = buildTaskDossier({
            data,
            scope,
            thumbs,
            generatedAt: this.now(),
            viewer: viewer || { id: currentUser.id, name: null },
            brand: this.brand,
            links: this.links,
        });

        const buffer = await this.renderer.render(dossier);
        return { buffer, fileName: `dossie-tarefa-${data.task.id}.pdf` };
    }

    /** @private @returns {Promise<Map<string, string>>} */
    async _buildThumbs(data) {
        const jobs = [
            ...listEvidenceThumbSources(data, LIMITS.MAX_EMBEDDED_THUMBS)
                .map(s => ({ ...s, size: DossierThumbSize.EVIDENCE })),
            ...listAvatarThumbSources(data.participants)
                .map(s => ({ ...s, size: DossierThumbSize.AVATAR })),
        ];

        const thumbs = new Map();
        let next = 0;
        const worker = async () => {
            while (next < jobs.length) {
                const job = jobs[next++];
                const uri = await this.thumbnailProvider.toDataUri(job.filePath, job.size);
                if (uri) thumbs.set(job.key, uri);
            }
        };
        await Promise.all(Array.from({ length: Math.min(THUMB_CONCURRENCY, jobs.length) }, worker));
        return thumbs;
    }
}

module.exports = { GtppTaskDossierUseCases };
