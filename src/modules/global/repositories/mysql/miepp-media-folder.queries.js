/**
 * @fileoverview Consultas SQL puras para `miepp_media_folders`.
 *
 * Schema em `GIPP-SQL/miepp-pastas-midia.sql`. As duas FKs que apontam para a
 * pasta (`parent_id` das subpastas e `miepp_media.folder_id`) são ON DELETE
 * RESTRICT: pasta com conteúdo não se exclui, e o caso de uso confere antes
 * para responder 409 com explicação em vez do errno 1451 cru.
 *
 * @module modules/global/repositories/mysql/miepp-media-folder.queries
 */

/**
 * Contagens por subconsulta, e não por JOIN + GROUP BY: são duas contagens
 * independentes sobre tabelas diferentes, e o JOIN das duas multiplicaria uma
 * pela outra. Ambas caem em índice (`idx_miepp_media_folders_parent`,
 * `idx_miepp_media_folder`).
 *
 * `parent_key` fica de fora — é só o artifício da chave única, não dado.
 */
const COLUMNS = `
    f.id, f.parent_id, f.name, f.created_by, f.created_at, f.updated_at,
    (SELECT COUNT(*) FROM miepp_media_folders c WHERE c.parent_id = f.id) AS folder_count,
    (SELECT COUNT(*) FROM miepp_media m WHERE m.folder_id = f.id)          AS media_count
`;

/**
 * TODAS as pastas, sem paginação: o painel monta a árvore do lado dele, e
 * paginar uma árvore corta galhos no meio. O volume é de dezenas, não milhares.
 */
const SQL_LIST_FOLDERS = `
    SELECT ${COLUMNS}
    FROM miepp_media_folders f
    ORDER BY f.name
`;

const SQL_GET_FOLDER_BY_ID = `
    SELECT ${COLUMNS}
    FROM miepp_media_folders f
    WHERE f.id = ?
`;

/** O nó "raiz" da árvore não é linha de tabela; as contagens dele vêm daqui. */
const SQL_COUNT_ROOT = `
    SELECT
        (SELECT COUNT(*) FROM miepp_media_folders WHERE parent_id IS NULL) AS folder_count,
        (SELECT COUNT(*) FROM miepp_media         WHERE folder_id IS NULL) AS media_count
`;

/**
 * Caminho da pasta até a raiz, incluindo ela mesma — ordenado da raiz para a
 * pasta, pronto para breadcrumb. Serve também à checagem de ciclo e de
 * profundidade (`depth` da pasta = número de linhas).
 *
 * `p.depth < 50` é trava contra laço: a aplicação impede ciclo, mas se um dia
 * alguém gravar um direto no banco, a consulta termina em vez de girar até o
 * `cte_max_recursion_depth`.
 *
 * Parâmetros: `[folderId]`
 */
const SQL_GET_FOLDER_PATH = `
    WITH RECURSIVE path AS (
        SELECT id, parent_id, name, 0 AS depth
          FROM miepp_media_folders
         WHERE id = ?
        UNION ALL
        SELECT f.id, f.parent_id, f.name, p.depth + 1
          FROM miepp_media_folders f
          JOIN path p ON f.id = p.parent_id
         WHERE p.depth < 50
    )
    SELECT id, name FROM path ORDER BY depth DESC
`;

/**
 * Quantos níveis a pasta carrega consigo (1 = sem subpastas). Usado ao MOVER:
 * a pasta leva as subpastas junto, e é a altura delas que precisa caber no
 * teto de profundidade no destino.
 *
 * Parâmetros: `[folderId]`
 */
const SQL_GET_SUBTREE_HEIGHT = `
    WITH RECURSIVE tree AS (
        SELECT id, 1 AS level
          FROM miepp_media_folders
         WHERE id = ?
        UNION ALL
        SELECT f.id, t.level + 1
          FROM miepp_media_folders f
          JOIN tree t ON f.parent_id = t.id
         WHERE t.level < 50
    )
    SELECT MAX(level) AS height FROM tree
`;

const SQL_INSERT_FOLDER = `
    INSERT INTO miepp_media_folders (parent_id, name, created_by)
    VALUES (?, ?, ?)
`;

/** Renomear e mover são o mesmo UPDATE: o caso de uso resolve o que manter. */
const SQL_UPDATE_FOLDER = `
    UPDATE miepp_media_folders
    SET parent_id = ?, name = ?
    WHERE id = ?
`;

const SQL_DELETE_FOLDER = `
    DELETE FROM miepp_media_folders WHERE id = ?
`;

module.exports = {
    SQL_LIST_FOLDERS,
    SQL_GET_FOLDER_BY_ID,
    SQL_COUNT_ROOT,
    SQL_GET_FOLDER_PATH,
    SQL_GET_SUBTREE_HEIGHT,
    SQL_INSERT_FOLDER,
    SQL_UPDATE_FOLDER,
    SQL_DELETE_FOLDER,
};
