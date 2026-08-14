/**
 * @fileoverview Monta o payload de sessão a partir do usuário (via stored
 * procedure `sp_get_user_authorization`) enriquecido com dados organizacionais
 * do Protheus (empresa, filial, centro de custo).
 *
 * @module modules/global/domain/auth/login-payload.mapper
 */

function nicknameFromName(name) {
    if (!name) return null;
    const parts = name.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
}

/**
 * @param {object} user - Linha retornada por `sp_get_user_authorization`.
 * @param {object} [orgData] - Linha do Protheus (SRA020/CTT020/SYS_COMPANY), ou {} se não encontrado.
 */
function mapUserWithOrganization(user, orgData = {}) {
    const name = user.name?.trim() ?? null;
    return {
        // USER
        id: user.id,
        username: user.user,
        name,
        nickname: nicknameFromName(name),
        registration: user.registration,
        status: user.ad_status,

        roles: user.roles ? user.roles.split(',') : [],
        permissions: user.permissions ? user.permissions.split(',') : [],
        application_ids: user.application_ids
            ? user.application_ids.split(',').map(Number)
            : [],

        // COMPANY
        company_code: orgData.M0_CODIGO?.trim() ?? null,
        company_name: orgData.M0_NOMECOM?.trim() ?? null,

        // BRANCH
        branch_code: orgData.M0_CODFIL?.trim() || user.branch_code,
        branch_name: orgData.M0_FILIAL?.trim() ?? null,

        // COST CENTER
        cost_center_code: orgData.CTT_CUSTO?.trim() ?? null,
        cost_center_description: orgData.CTT_DESC01?.trim() ?? null,
    };
}

module.exports = { nicknameFromName, mapUserWithOrganization };
