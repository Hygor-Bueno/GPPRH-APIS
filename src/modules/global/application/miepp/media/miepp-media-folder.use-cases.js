/**
 * @fileoverview Casos de uso das pastas da biblioteca de mídia
 * (`miepp_media_folders`).
 *
 * Pasta é só organização do painel. O player não sabe que ela existe, e
 * nenhuma operação daqui toca em playlist, agendamento ou no binário.
 *
 * O que o banco garante sozinho: nome único entre irmãs e pasta não vazia não
 * se exclui. O que só este arquivo garante: sem ciclo e sem passar do teto de
 * profundidade — ver `domain/miepp/media/media-folder.rules`.
 *
 * @module modules/global/application/miepp/media/miepp-media-folder.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const {
    normalizeFolderId,
    assertNoCycle,
    assertDepth,
} = require('../../../domain/miepp/media/media-folder.rules');

class MieppMediaFolderUseCases {
    /**
     * @param {object} deps
     * @param {import('./ports/media-folder-repository.port').MediaFolderRepositoryPort} deps.repository
     */
    constructor({ repository }) {
        this.repository = repository;
    }

    /** @private */
    async _requireFolder(id, message = 'Pasta não encontrada.') {
        const folder = await this.repository.findById(id);
        if (!folder) throw new AppError(message, 404);
        return folder;
    }

    /**
     * Nome sem espaço nas pontas. O validador da rota já garante 1–100
     * caracteres, mas "   " passa por ele e viraria uma pasta sem nome visível.
     * @private
     */
    _normalizeName(name) {
        const trimmed = String(name ?? '').trim();
        if (!trimmed) throw new AppError("O campo 'name' é obrigatório.", 400);
        return trimmed;
    }

    /**
     * A árvore inteira, achatada: cada pasta com `parent_id`, e o painel monta
     * os galhos. `root` traz as contagens do nó raiz, que não é linha de
     * tabela — sem ele o painel não saberia quantas mídias estão fora de pasta.
     */
    async list() {
        const [items, root] = await Promise.all([
            this.repository.list(),
            this.repository.countRoot(),
        ]);
        return { items, root };
    }

    /** A pasta com `path` (raiz → pasta, incluindo ela), pronto para breadcrumb. */
    async getById(id) {
        const folder = await this._requireFolder(id);
        const path = await this.repository.getPath(id);
        return { ...folder, path };
    }

    /**
     * @param {{name: string, parent_id?: number|null}} payload
     * @param {object} actor - `req.user`; vai em `created_by`.
     */
    async create(payload, actor) {
        const name = this._normalizeName(payload.name);
        const parentId = normalizeFolderId(payload.parent_id, 'parent_id') ?? null;

        if (parentId !== null) {
            await this._requireFolder(parentId, 'Pasta de destino não encontrada.');
            const parentPath = await this.repository.getPath(parentId);
            assertDepth(parentPath.length, 1);
        }

        const id = await this.repository.create({
            parent_id: parentId,
            name,
            created_by: actor?.id ?? null,
        });

        return this.getById(id);
    }

    /**
     * Renomear e mover. `parent_id` ausente mantém o lugar; `null` manda para
     * a raiz.
     *
     * Ao mover, a pasta leva as subpastas e as mídias junto — nada dentro dela
     * muda de linha, só o `parent_id` desta.
     */
    async update(id, payload) {
        const current = await this._requireFolder(id);

        const name = payload.name === undefined ? current.name : this._normalizeName(payload.name);
        const requested = normalizeFolderId(payload.parent_id, 'parent_id');
        const parentId = requested === undefined ? current.parent_id : requested;

        if (parentId !== current.parent_id && parentId !== null) {
            await this._requireFolder(parentId, 'Pasta de destino não encontrada.');

            const parentPath = await this.repository.getPath(parentId);
            assertNoCycle(id, parentId, parentPath.map((node) => node.id));

            const height = await this.repository.getSubtreeHeight(id);
            assertDepth(parentPath.length, height);
        }

        await this.repository.update(id, { parent_id: parentId, name });

        return this.getById(id);
    }

    /**
     * Só pasta vazia. A FK (ON DELETE RESTRICT) recusaria de qualquer jeito;
     * conferir antes é o que permite dizer QUANTO há dentro, em vez de repassar
     * o errno 1451.
     *
     * Não existe exclusão em cascata de propósito (decisão do requerente): as
     * mídias podem estar em playlist no ar, e apagar pasta não deveria ser um
     * jeito de tirar conteúdo da parede sem ver o quê.
     */
    async remove(id) {
        const folder = await this._requireFolder(id);

        if (folder.folder_count > 0 || folder.media_count > 0) {
            throw new AppError(
                `A pasta não está vazia (${folder.folder_count} subpasta(s), ${folder.media_count} mídia(s)). `
                + 'Mova ou exclua o conteúdo antes.',
                409
            );
        }

        await this.repository.remove(id);
        return { id: Number(id) };
    }
}

module.exports = { MieppMediaFolderUseCases };
