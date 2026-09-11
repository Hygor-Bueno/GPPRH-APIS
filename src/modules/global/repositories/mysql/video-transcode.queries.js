/**
 * @fileoverview Queries SQL puras — fila de transcodificação de vídeo.
 *
 * A fila é chaveada por `file_id`, não por anexo: a deduplicação por hash faz
 * vários comentários (e vários módulos) apontarem para o mesmo arquivo físico,
 * e converter o mesmo arquivo duas vezes seria desperdício e corrida.
 *
 * @module modules/global/repositories/mysql/video-transcode.queries
 */

'use strict';

/**
 * Enfileira um arquivo. `INSERT IGNORE` porque `file_id` é UNIQUE — se o
 * arquivo já está na fila (upload duplicado que caiu na deduplicação), a
 * segunda tentativa vira no-op em vez de erro.
 *
 * Parâmetros: [file_id, source_codec, source_size]
 */
const SQL_ENQUEUE = `
  INSERT IGNORE INTO gt_video_transcode_queue (file_id, source_codec, source_size, status)
  VALUES (?, ?, ?, 'pending')
`;

/**
 * Reserva o job pendente mais antigo para este worker.
 *
 * `FOR UPDATE SKIP LOCKED` (MySQL 8+) faz a reserva atômica: dois workers
 * concorrentes pegam jobs diferentes em vez de disputar o mesmo. Hoje roda um
 * worker só, mas isso permite subir a concorrência sem mudar o SQL.
 *
 * Precisa rodar DENTRO de uma transação, senão o lock é liberado na hora.
 */
const SQL_CLAIM_SELECT = `
  SELECT q.id, q.file_id, q.attempts, f.file_path, f.file_name, f.file_extension, f.video_codec, f.file_size
    FROM gt_video_transcode_queue q
    JOIN _files f ON f.id = q.file_id
   WHERE q.status = 'pending' AND f.status = 1
   ORDER BY q.created_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED
`;

/** Parâmetros: [locked_by, id] */
const SQL_CLAIM_MARK = `
  UPDATE gt_video_transcode_queue
     SET status = 'processing', locked_at = NOW(), locked_by = ?, attempts = attempts + 1
   WHERE id = ?
`;

/** Parâmetros: [result_size, id] */
const SQL_MARK_DONE = `
  UPDATE gt_video_transcode_queue
     SET status = 'done', result_size = ?, locked_at = NULL, error_message = NULL
   WHERE id = ?
`;

/**
 * Falha o job. Volta para `pending` enquanto houver tentativa sobrando, para
 * uma falha transitória (disco cheio, ffmpeg morto por OOM) não condenar o
 * arquivo — só vira `failed` de vez no limite.
 *
 * Parâmetros: [error_message, max_attempts, id]
 */
const SQL_MARK_FAILED = `
  UPDATE gt_video_transcode_queue
     SET status = IF(attempts >= ?, 'failed', 'pending'),
         error_message = ?,
         locked_at = NULL,
         locked_by = NULL
   WHERE id = ?
`;

/**
 * Devolve à fila os jobs que ficaram presos em `processing` — worker morto no
 * meio, container reiniciado, OOM. Sem isto o anexo ficaria "processando" para
 * sempre na tela do usuário.
 *
 * Parâmetros: [minutos]
 */
const SQL_RELEASE_STUCK = `
  UPDATE gt_video_transcode_queue
     SET status = 'pending', locked_at = NULL, locked_by = NULL
   WHERE status = 'processing'
     AND locked_at IS NOT NULL
     AND locked_at < NOW() - INTERVAL ? MINUTE
`;

/**
 * Substitui o arquivo convertido em `_files`.
 *
 * O hash MUDA junto — o conteúdo é outro. Sem recalcular, a deduplicação
 * passaria a casar uploads novos com um hash que não corresponde mais ao
 * arquivo em disco.
 *
 * Parâmetros: [file_path, file_extension, file_type, file_size, file_hash, video_codec, id]
 */
const SQL_REPLACE_FILE = `
  UPDATE _files
     SET file_path = ?, file_extension = ?, file_type = ?, file_size = ?,
         file_hash = ?, video_codec = ?, updated_at = NOW()
   WHERE id = ?
`;

/** Atualiza o ciclo de processamento de todos os anexos que apontam para o arquivo. */
const SQL_SET_ATTACHMENT_STATUS = `
  UPDATE gt_task_item_response_files
     SET processing_status = ?
   WHERE file_id = ? AND status = 1
`;

/**
 * Tarefas afetadas por um arquivo — para saber a quem emitir o evento WS.
 *
 * DISTINCT porque o mesmo arquivo pode estar em vários comentários da mesma
 * tarefa. Arquivo de chat não retorna linha nenhuma, e nesse caso não há
 * evento GTPP a emitir.
 *
 * Parâmetros: [file_id]
 */
const SQL_FIND_AFFECTED_TASKS = `
  SELECT DISTINCT i.task_id, rf.task_item_response_id_fk AS response_id, r.task_item_id_fk AS item_id
    FROM gt_task_item_response_files rf
    JOIN gt_task_item_response r ON r.id = rf.task_item_response_id_fk
    JOIN gt_task_item i ON i.id = r.task_item_id_fk
   WHERE rf.file_id = ? AND rf.status = 1
`;

module.exports = {
    SQL_ENQUEUE,
    SQL_CLAIM_SELECT,
    SQL_CLAIM_MARK,
    SQL_MARK_DONE,
    SQL_MARK_FAILED,
    SQL_RELEASE_STUCK,
    SQL_REPLACE_FILE,
    SQL_SET_ATTACHMENT_STATUS,
    SQL_FIND_AFFECTED_TASKS,
};
