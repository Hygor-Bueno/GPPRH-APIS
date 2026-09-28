/**
 * @fileoverview Regras das pastas da biblioteca de mídia (`miepp_media_folders`).
 *
 * Puro. Pasta é organização do PAINEL: o player não enxerga pasta nenhuma, e
 * mover mídia de pasta não mexe em uuid nem em checksum — nenhuma tela rebaixa
 * nada por causa disto.
 *
 * O que mora aqui é o que o banco NÃO garante sozinho (ver
 * `GIPP-SQL/miepp-pastas-midia.sql`): profundidade e o vocabulário de "raiz"
 * que chega pela query string e pelo corpo.
 *
 * @module modules/global/domain/miepp/media/media-folder.rules
 */

const { AppError } = require('../../../../../errors/app.error');

/**
 * Quantos níveis de pasta cabem, contando a da raiz como 1.
 *
 * O schema não limita. O teto existe porque o caminho (breadcrumb) é uma
 * consulta recursiva e porque árvore funda demais é sinal de pasta sendo usada
 * como etiqueta — que é o papel da playlist, não da pasta.
 */
const MAX_FOLDER_DEPTH = 5;

/** Valor que o painel usa para "raiz" na query string e no corpo. */
const ROOT = 'root';

/**
 * Filtro de pasta da listagem de mídia.
 *
 * Três estados, e não dois: sem o parâmetro a listagem continua devolvendo
 * TUDO — é o contrato que o painel e qualquer chamada antiga já usam. `root`
 * pede só o que está fora de pasta.
 *
 * Valor inválido é 400, e não "sem filtro" como no `?origin=`: aqui "sem
 * filtro" devolveria a biblioteca inteira dentro de uma pasta que o usuário
 * abriu, e ele concluiria que a pasta tem tudo aquilo.
 *
 * @param {*} value - `req.query.folder_id`.
 * @returns {{mode: 'all'|'root'|'folder', folderId: number|null}}
 */
function normalizeFolderFilter(value) {
    if (value === undefined || value === null || value === '') {
        return { mode: 'all', folderId: null };
    }
    if (value === ROOT) return { mode: 'root', folderId: null };

    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
        throw new AppError(`Filtro de pasta inválido: use o id da pasta ou "${ROOT}".`, 400);
    }
    return { mode: 'folder', folderId: id };
}

/**
 * `folder_id` / `parent_id` vindos do corpo.
 *
 * `undefined` (campo ausente) é diferente de `null` (mandar para a raiz): no
 * PUT, ausente significa "não mexer". O multipart do upload não sabe mandar
 * `null`, então `''` e `"root"` também valem raiz.
 *
 * @param {*} value
 * @param {string} field - nome do campo, para a mensagem.
 * @returns {number|null|undefined}
 */
function normalizeFolderId(value, field = 'folder_id') {
    if (value === undefined) return undefined;
    if (value === null || value === '' || value === ROOT) return null;

    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
        throw new AppError(`O campo '${field}' deve ser o id de uma pasta, ou null para a raiz.`, 400);
    }
    return id;
}

/**
 * Recusa mover a pasta para dentro dela mesma ou de uma descendente.
 *
 * O banco não barra: FK aceita o laço, e o MySQL não admite CHECK em coluna
 * com ação referencial. Sem esta regra a árvore vira ciclo — a pasta some do
 * painel (nenhum caminho a alcança a partir da raiz) e o breadcrumb só para
 * pela trava de profundidade da consulta.
 *
 * @param {number} folderId - a pasta sendo movida.
 * @param {number|null} targetParentId - o novo pai (`null` = raiz).
 * @param {number[]} targetAncestorIds - ids do caminho do novo pai até a raiz,
 *        incluindo o próprio novo pai.
 */
function assertNoCycle(folderId, targetParentId, targetAncestorIds) {
    if (targetParentId === null) return;
    if (targetAncestorIds.map(Number).includes(Number(folderId))) {
        throw new AppError('Não é possível mover uma pasta para dentro dela mesma ou de uma subpasta dela.', 409);
    }
}

/**
 * A árvore cabe no teto depois da operação?
 *
 * @param {number} parentDepth - profundidade do novo pai (raiz = 0, pasta na
 *        raiz = 1).
 * @param {number} subtreeHeight - níveis que a pasta leva junto (1 = sem
 *        subpastas; ao criar, sempre 1).
 */
function assertDepth(parentDepth, subtreeHeight = 1) {
    if (parentDepth + subtreeHeight > MAX_FOLDER_DEPTH) {
        throw new AppError(`Limite de ${MAX_FOLDER_DEPTH} níveis de pasta excedido.`, 409);
    }
}

module.exports = {
    MAX_FOLDER_DEPTH,
    ROOT,
    normalizeFolderFilter,
    normalizeFolderId,
    assertNoCycle,
    assertDepth,
};
