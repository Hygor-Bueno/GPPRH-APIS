/**
 * @fileoverview Links do dossiê para a tela do GTPP no front web.
 *
 * O PDF circula fora do sistema, então o link NUNCA dá acesso direto ao
 * arquivo: ele abre a tarefa no front, que passa pelo login e pela permissão
 * de sempre e só então mostra o item/anexo pedido.
 *
 * Contrato da query (o front interpreta em `/services/gtpp`):
 *   ?task=T                         abre a tarefa
 *   ?task=T&item=I                  abre a tarefa no item I (gt_task_item.id)
 *   ?task=T&item=I&file=item        abre o arquivo do próprio item
 *   ?task=T&item=I&attachment=A     abre o anexo A de comentário (gt_task_item_response_files.id)
 *   ?task=T&message=M               abre o chat na mensagem M (gt_message.id), com o arquivo dela
 *
 * @module modules/global/domain/gtpp/task-dossier/task-dossier-links
 */

'use strict';

const GTPP_WEB_PATH = '/services/gtpp';

/**
 * @param {string|null|undefined} webBaseUrl - origem do front, ex.: `https://gigpp.com.br:73`.
 * @returns {null|{
 *   task: (taskId: number) => string,
 *   item: (taskId: number, itemId: number) => string,
 *   itemFile: (taskId: number, itemId: number) => string,
 *   responseFile: (taskId: number, itemId: number, attachmentId: number) => string,
 *   message: (taskId: number, messageId: number) => string,
 * }} `null` sem base válida — o dossiê sai sem links.
 */
function buildDossierLinks(webBaseUrl) {
    const base = String(webBaseUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(base)) return null;

    const url = (params) => `${base}${GTPP_WEB_PATH}?${new URLSearchParams(params).toString()}`;

    return {
        task:         (taskId) => url({ task: taskId }),
        item:         (taskId, itemId) => url({ task: taskId, item: itemId }),
        itemFile:     (taskId, itemId) => url({ task: taskId, item: itemId, file: 'item' }),
        responseFile: (taskId, itemId, attachmentId) => url({ task: taskId, item: itemId, attachment: attachmentId }),
        message:      (taskId, messageId) => url({ task: taskId, message: messageId }),
    };
}

module.exports = { buildDossierLinks, GTPP_WEB_PATH };
