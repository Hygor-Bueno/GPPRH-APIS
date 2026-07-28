/**
 * @fileoverview Lógica pura de enriquecimento de usuários com dados
 * organizacionais do Protheus (empresa, filial, centro de custo).
 *
 * @module modules/global/domain/employee/user-organization.shaper
 */

/**
 * Chave de pareamento matrícula+filial. A mesma matrícula pode existir em
 * mais de uma filial no Protheus (transferência, registro histórico) — sem
 * esse par a busca podia cruzar com o registro errado (ex: um antigo, já
 * demitido, de outra filial).
 */
function buildOrgKey(registration, branchCode) {
    return `${String(registration).trim()}|${String(branchCode).trim()}`;
}

/** @param {object[]} protheusRows @returns {Map<string, object>} */
function buildOrgMap(protheusRows) {
    const map = new Map();
    for (const row of protheusRows) {
        map.set(buildOrgKey(row.registration, row.branch_code), row);
    }
    return map;
}

/**
 * Cruza usuários do MySQL com dados do Protheus, excluindo os que já têm
 * data de demissão lá, e monta o formato final de resposta.
 * @param {object[]} userRows
 * @param {Map<string, object>} orgMap
 */
function mergeUsersWithOrganization(userRows, orgMap) {
    return userRows
        .filter(({ registration, branch_code }) => {
            const org = orgMap.get(buildOrgKey(registration, branch_code));
            // Se encontrou no Protheus e tem data de demissão, exclui
            return !(org && org.ra_demissa);
        })
        .map(user => {
            const org = orgMap.get(buildOrgKey(user.registration, user.branch_code)) ?? {};
            return {
                id: user.id,
                name: user.name,
                registration: user.registration,
                status: user.status,
                file_id: user.file_id ?? null,
                branch_code: user.branch_code ?? null,
                company_code: org.company_code ?? null,
                company_name: org.company_name ?? null,
                branch_name: org.branch_name ?? null,
                cnpj: org.cnpj ?? null,
                cost_center_code: org.cost_center_code ?? null,
                cost_center_description: org.cost_center_description ?? null,
            };
        });
}

module.exports = { buildOrgKey, buildOrgMap, mergeUsersWithOrganization };
