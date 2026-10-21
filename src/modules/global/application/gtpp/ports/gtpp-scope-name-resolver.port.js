/**
 * @fileoverview Porta (contrato) compartilhada entre Task Scope e Task Dossier —
 * traduz os códigos de escopo (empresa/filial/centro de custo) em nomes.
 *
 * @module modules/global/application/gtpp/ports/gtpp-scope-name-resolver.port
 */

class GtppScopeNameResolverPort {
    /**
     * Devolve as mesmas linhas com `company_name`, `branch_name` e
     * `cost_center_name` (null quando o código é null ou não foi achado).
     * Nunca lança por falha da origem dos nomes: devolve os nomes como null.
     *
     * @param {Array<{company_code: string|null, branch_code: string|null, cost_center_code: string|null}>} scopeRows
     * @returns {Promise<object[]>}
     */
    resolve(scopeRows) { throw new Error('Not implemented'); }
}

module.exports = { GtppScopeNameResolverPort };
