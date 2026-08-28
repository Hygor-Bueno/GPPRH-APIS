/**
 * @fileoverview Repositório MySQL para resolução de usuário GAPP.
 *
 * Extraído de `gapp-active.repository.js` — usado tanto por Active quanto
 * por Expenses (antes duplicado como método idêntico em cada service).
 *
 * @module modules/global/repositories/mysql/gapp-user.queries
 */

/**
 * Resolve o gapp_user.user_id e o work_group_fk (via gapp_level) do usuário
 * autenticado a partir do `id` (_user.id) que vem no JWT — usado para
 * preencher `user_id_fk`/`work_group_fk` sozinho, sem depender do que o
 * cliente mandar no body.
 */
function sqlGetUserAuthByAccessCode() {
    return `
        SELECT
            u.user_id,
            l.group_id_fk AS work_group_fk
        FROM global.gapp_user u
        INNER JOIN global.gapp_level l ON l.level_id = u.level_id_fk
        WHERE u.access_code = ?
    `;
}

module.exports = { sqlGetUserAuthByAccessCode };
