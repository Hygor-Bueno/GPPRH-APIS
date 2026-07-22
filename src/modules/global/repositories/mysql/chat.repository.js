/**
 * @fileoverview Repositório MySQL — Chat direto (cl_message).
 *
 * ⚠️  AVISO SOBRE NOMENCLATURA LEGADA DO BANCO:
 * A tabela `cl_message` herdada do sistema PHP tem os campos nomeados de forma invertida:
 *   - `id_user`   → armazena o ID do REMETENTE (quem enviou)
 *   - `id_sender` → armazena o ID do DESTINATÁRIO (quem recebe)
 * Esta inversão é mantida para compatibilidade. O código Node.js usa nomes claros
 * (`sender_id`, `recipient_id`) via aliases SQL para evitar confusão.
 *
 * Mensagens de grupo (`id_group IS NOT NULL`) são ignoradas por todas as queries.
 *
 * @module modules/global/repositories/mysql/chat.repository
 */

/** Quantidade de mensagens retornadas por página. @constant {number} */
const PAGE_SIZE = 20;

// ─── Conversas ────────────────────────────────────────────────────────────────

/**
 * Retorna a lista de conversas diretas do usuário com contagem de não lidas.
 *
 * Para cada conversa retorna: `partner_id`, `partner_name` e `unread_count`.
 * O nome do parceiro é buscado em `_employee` (com fallback para `_user.name`).
 *
 * Parâmetros (7x `userId`):
 * `[userId, userId, userId, userId, userId, userId, userId]`
 *
 * @returns {string}
 */
function sqlGetConversations() {
    return `
        SELECT
            base.partner_id,
            base.partner_name,
            base.last_message_date,
            pu.file_id AS partner_file_id,
            (
                SELECT COUNT(*)
                FROM cl_message s
                WHERE s.id_user      = base.partner_id
                  AND s.id_sender    = ?
                  AND s.notification = 1
                  AND s.id_group     IS NULL
            ) AS unread_count
        FROM (
            SELECT
                IF(m.id_user = ?, m.id_sender, m.id_user)             AS partner_id,
                UPPER(TRIM(COALESCE(e.name, u.name, 'Desconhecido'))) AS partner_name,
                MAX(m.date)                                             AS last_message_date
            FROM cl_message m
            LEFT JOIN _employee e ON e.id = IF(m.id_user = ?, m.id_sender, m.id_user)
            LEFT JOIN _user     u ON u.id = IF(m.id_user = ?, m.id_sender, m.id_user)
            WHERE (m.id_user = ? OR m.id_sender = ?)
              AND m.id_group IS NULL
              AND IF(m.id_user = ?, m.id_sender, m.id_user) != ?
            GROUP BY partner_id, partner_name
        ) base
        LEFT JOIN _user pu ON pu.id = base.partner_id
        ORDER BY base.last_message_date DESC, base.partner_name
    `;
}

// ─── Mensagens ────────────────────────────────────────────────────────────────

/**
 * Conta o total de mensagens entre dois usuários (para paginação).
 *
 * Parâmetros: `[userId, partnerId, partnerId, userId]`
 *
 * @returns {string}
 */
function sqlCountMessages() {
    return `
        SELECT COUNT(*) AS total
        FROM cl_message
        WHERE ((id_user = ? AND id_sender = ?) OR (id_user = ? AND id_sender = ?))
          AND id_group IS NULL
    `;
}

/**
 * Retorna mensagens paginadas entre dois usuários, ordenadas do mais recente para o mais antigo.
 *
 * Os aliases `sender_id` e `recipient_id` corrigem a nomenclatura invertida do banco.
 * `offset` é interpolado diretamente na query (inteiro sanitizado) para evitar o bug do
 * driver `mysql2` com placeholders `?` em cláusulas `LIMIT`/`OFFSET`.
 *
 * Parâmetros: `[userId, partnerId, partnerId, userId]`
 *
 * @param {number} offset - Número de linhas a pular (calculado como `(page-1) * PAGE_SIZE`).
 * @returns {string}
 */
function sqlGetMessages(offset) {
    return `
        SELECT
            id,
            id_user   AS sender_id,
            id_sender AS recipient_id,
            message,
            notification,
            type,
            file_id,
            file_name,
            date
        FROM cl_message
        WHERE ((id_user = ? AND id_sender = ?) OR (id_user = ? AND id_sender = ?))
          AND id_group IS NULL
        ORDER BY id DESC
        LIMIT ${PAGE_SIZE} OFFSET ${parseInt(offset, 10)}
    `;
}

/**
 * Insere uma nova mensagem direta.
 *
 * Parâmetros: `[sender_id, message, recipient_id, type, file_id]`
 *
 * Nota: `id_user` recebe o remetente e `id_sender` recebe o destinatário
 * (nomenclatura invertida do banco legado).
 * `notification = 1` (não lida) é definida na inserção.
 * `file_id` é NULL para mensagens de texto.
 *
 * @returns {string}
 */
function sqlInsertMessage() {
    return `
        INSERT INTO cl_message (id_user, message, id_sender, notification, type, file_id, file_name, date)
        VALUES (?, ?, ?, 1, ?, ?, ?, NOW())
    `;
}

/**
 * Retorna uma mensagem pelo ID (usado após inserção para retornar o registro completo).
 *
 * Parâmetros: `[id]`
 *
 * @returns {string}
 */
function sqlGetMessageById() {
    return `
        SELECT
            id,
            id_user   AS sender_id,
            id_sender AS recipient_id,
            message,
            notification,
            type,
            file_id,
            file_name,
            date
        FROM cl_message
        WHERE id = ?
    `;
}

// ─── Notificações ─────────────────────────────────────────────────────────────

/**
 * Marca todas as mensagens recebidas de um parceiro como lidas (`notification = 0`).
 *
 * Parâmetros: `[partner_id, current_user_id]`
 *
 * Semantica: `id_user = partner_id` (parceiro é o remetente no DB)
 *            `id_sender = current_user_id` (eu sou o destinatário no DB)
 *
 * @returns {string}
 */
function sqlMarkAsRead() {
    return `
        UPDATE cl_message
        SET notification = 0
        WHERE id_user = ? AND id_sender = ? AND notification = 1 AND id_group IS NULL
    `;
}

module.exports = {
    PAGE_SIZE,
    sqlGetConversations,
    sqlCountMessages,
    sqlGetMessages,
    sqlInsertMessage,
    sqlGetMessageById,
    sqlMarkAsRead
};
