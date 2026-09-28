/**
 * @fileoverview Adapter MySQL de `miepp_media_folders`.
 *
 * @module modules/global/infrastructure/miepp/mysql-miepp-media-folder.repository
 */

const { MediaFolderRepositoryPort } = require('../../application/miepp/media/ports/media-folder-repository.port');
const { AppError } = require('../../../../errors/app.error');
const { query, execute } = require('./miepp-mysql.helper');
const {
    SQL_LIST_FOLDERS,
    SQL_GET_FOLDER_BY_ID,
    SQL_COUNT_ROOT,
    SQL_GET_FOLDER_PATH,
    SQL_GET_SUBTREE_HEIGHT,
    SQL_INSERT_FOLDER,
    SQL_UPDATE_FOLDER,
    SQL_DELETE_FOLDER,
} = require('../../repositories/mysql/miepp-media-folder.queries');

/**
 * Erros do MySQL que têm resposta certa para o painel.
 *
 * O caso de uso já confere tudo isto antes de escrever; a tradução cobre a
 * corrida (duas pessoas criando "Natal" no mesmo segundo, uma excluindo a
 * pasta que a outra está usando como destino). Sem ela a corrida vira 500.
 */
const TRANSLATED = Object.freeze({
    ER_DUP_ENTRY: () => new AppError('Já existe uma pasta com esse nome neste local.', 409),
    ER_ROW_IS_REFERENCED_2: () => new AppError('A pasta não está vazia. Mova ou exclua o conteúdo antes.', 409),
    ER_NO_REFERENCED_ROW_2: () => new AppError('Pasta de destino não encontrada.', 404),
});

/** @param {() => Promise<*>} run */
async function translating(run) {
    try {
        return await run();
    } catch (error) {
        const translate = TRANSLATED[error?.details?.code];
        if (translate) throw translate();
        throw error;
    }
}

/**
 * Contagens de subconsulta chegam como string ou BigInt dependendo da versão
 * do driver; o painel compara com número.
 */
function shape(row) {
    if (!row) return null;
    return {
        ...row,
        parent_id: row.parent_id === null ? null : Number(row.parent_id),
        folder_count: Number(row.folder_count ?? 0),
        media_count: Number(row.media_count ?? 0),
    };
}

class MysqlMieppMediaFolderRepository extends MediaFolderRepositoryPort {
    async list() {
        const rows = await query(SQL_LIST_FOLDERS);
        return rows.map(shape);
    }

    async findById(id) {
        const rows = await query(SQL_GET_FOLDER_BY_ID, [id]);
        return shape(rows[0]);
    }

    async countRoot() {
        const rows = await query(SQL_COUNT_ROOT);
        return {
            folder_count: Number(rows[0]?.folder_count ?? 0),
            media_count: Number(rows[0]?.media_count ?? 0),
        };
    }

    async getPath(id) {
        const rows = await query(SQL_GET_FOLDER_PATH, [id]);
        return rows.map((row) => ({ id: Number(row.id), name: row.name }));
    }

    async getSubtreeHeight(id) {
        const rows = await query(SQL_GET_SUBTREE_HEIGHT, [id]);
        return Number(rows[0]?.height ?? 1);
    }

    async create(payload) {
        const result = await translating(() => execute(SQL_INSERT_FOLDER, [
            payload.parent_id, payload.name, payload.created_by,
        ]));
        return result.insertId;
    }

    async update(id, payload) {
        await translating(() => execute(SQL_UPDATE_FOLDER, [
            payload.parent_id, payload.name, id,
        ]));
    }

    async remove(id) {
        await translating(() => execute(SQL_DELETE_FOLDER, [id]));
    }
}

module.exports = { MysqlMieppMediaFolderRepository };
