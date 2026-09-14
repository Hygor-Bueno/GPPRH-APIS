/**
 * @fileoverview Matriz de permissão do painel meipp (`meipp_users.role`).
 *
 * Puro e síncrono: recebe o papel já resolvido e responde sim/não. Quem lê o
 * papel no banco é o caso de uso / middleware.
 *
 * Os três papéis são hierárquicos — `admin` ⊃ `editor` ⊃ `viewer` —, então a
 * checagem é por patamar mínimo em vez de lista de papéis, o que evita rotas
 * novas nascerem com `['admin', 'editor']` esquecendo um dos dois.
 *
 * | Papel    | Leitura | CRUD de conteúdo | Usuários / exclusão de player / auditoria |
 * |----------|---------|------------------|-------------------------------------------|
 * | `viewer` | ✔       | ✘                | ✘                                         |
 * | `editor` | ✔       | ✔                | ✘                                         |
 * | `admin`  | ✔       | ✔                | ✔                                         |
 *
 * @module modules/global/domain/meipp/meipp-access.rules
 */

const { MeippRole } = require('./meipp.enums');

/**
 * Patamar numérico de cada papel. Só existe para a comparação `>=`; não é
 * gravado em lugar nenhum e pode ser renumerado à vontade.
 */
const ROLE_RANK = Object.freeze({
    [MeippRole.VIEWER]: 1,
    [MeippRole.EDITOR]: 2,
    [MeippRole.ADMIN]:  3,
});

/**
 * O papel alcança o patamar mínimo exigido?
 *
 * Papel desconhecido (ou ausente) nunca alcança nada — é o comportamento certo
 * para o caso em que alguém edita `meipp_users.role` direto no banco com um
 * valor fora do ENUM.
 *
 * @param {string|null|undefined} role    - `meipp_users.role`.
 * @param {string}                minimum - papel mínimo exigido.
 * @returns {boolean}
 */
function hasAtLeast(role, minimum) {
    const actual   = ROLE_RANK[role] || 0;
    const required = ROLE_RANK[minimum] || 0;
    return required > 0 && actual >= required;
}

/** Pode ler qualquer coisa do módulo. */
const canRead = (role) => hasAtLeast(role, MeippRole.VIEWER);

/** Pode criar/editar locais, players, grupos, mídia, playlists, agendamentos e comandos. */
const canWrite = (role) => hasAtLeast(role, MeippRole.EDITOR);

/** Pode gerir usuários, desativar players, revogar tokens e ler a auditoria. */
const canAdminister = (role) => hasAtLeast(role, MeippRole.ADMIN);

module.exports = { ROLE_RANK, hasAtLeast, canRead, canWrite, canAdminister };
