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
 * Campos que `sp_get_user_authorization` precisa devolver.
 *
 * A procedure lista as colunas explicitamente, então acrescentar uma coluna à
 * tabela `_user` não basta — é preciso alterá-la também. Quando isso é esquecido,
 * o campo chega `undefined` e some sem erro: `Boolean(undefined)` vira `false` e
 * `undefined.split(',')` viraria `[]` pelo operador ternário abaixo.
 *
 * Foi o que aconteceu em 08/2026 com `must_change_password`: a troca de senha
 * obrigatória ficou inativa por completo — nem o `/me` nem o middleware barravam
 * —, porque ambos leem do token e o token foi carimbado com `false` na origem.
 *
 * Perder `permissions` do mesmo jeito seria pior: o usuário ficaria sem nenhuma
 * permissão, e a tela pareceria apenas "sem acesso".
 */
const REQUIRED_AUTHORIZATION_FIELDS = [
    'id',
    'user',
    'ad_status',
    'application_ids',
    'roles',
    'permissions',
    'must_change_password',
];

/**
 * @param {object} user - Linha retornada por `sp_get_user_authorization`.
 * @param {object} [orgData] - Linha do Protheus (SRA020/CTT020/SYS_COMPANY), ou {} se não encontrado.
 * @throws {Error} Se a procedure não devolver algum campo esperado.
 */
function mapUserWithOrganization(user, orgData = {}) {
    // `GROUP_CONCAT` devolve NULL quando não há linhas, então checar a presença
    // da CHAVE, não o valor — `null` é resposta legítima, ausência não é.
    const missing = REQUIRED_AUTHORIZATION_FIELDS.filter(f => !(f in user));
    if (missing.length) {
        throw new Error(
            `sp_get_user_authorization não devolveu: ${missing.join(', ')}. ` +
            `A procedure lista as colunas explicitamente — atualize-a ao acrescentar campos em _user.`
        );
    }

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

        // Ligada pelo reset da gestão de acessos. Enquanto verdadeira, o
        // `must-change-password.middleware` barra tudo que não seja /me,
        // /logout e /change-password — a tela de troca no front é conveniência,
        // não o que garante a regra.
        must_change_password: Boolean(user.must_change_password),

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

module.exports = {
    nicknameFromName,
    mapUserWithOrganization,
    REQUIRED_AUTHORIZATION_FIELDS,
};
