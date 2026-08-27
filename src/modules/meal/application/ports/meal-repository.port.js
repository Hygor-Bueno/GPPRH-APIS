/**
 * @fileoverview Porta (contrato) de persistência SQL Server — refeitório.
 * @module modules/meal/application/ports/meal-repository.port
 */

class MealRepositoryPort {
    // ─── Comensais ──────────────────────────────────────────────────────────

    /**
     * Lista para o cache offline do aparelho.
     * @param {{branchCode?: ?string, terminatedWindowDays?: number}} options
     * @returns {Promise<object[]>}
     */
    findDinersForCache(options) { throw new Error('Not implemented'); }

    /**
     * Resolve uma matrícula e devolve, junto, quantas refeições ela já fez na
     * data — `meals_today`.
     * @param {{companyCode: string, employeeId: string, branchCode: string}} key
     * @param {string} serviceDate - `YYYY-MM-DD`, data civil.
     * @returns {Promise<?object>} `null` quando a matrícula não existe no Protheus.
     */
    findDiner(key, serviceDate) { throw new Error('Not implemented'); }

    /**
     * Contagem do dia sem depender da view — serve para quem saiu da janela de
     * desligamento mas tem histórico.
     * @param {{companyCode: string, employeeId: string, branchCode: string}} key
     * @param {string} serviceDate
     * @returns {Promise<number>}
     */
    countMealsByDinerOnDate(key, serviceDate) { throw new Error('Not implemented'); }

    /**
     * A filial existe no cadastro do Protheus?
     * O CHECK do banco garante o formato, não a existência.
     * @param {string} branchCode
     * @returns {Promise<?object>}
     */
    findBranch(branchCode) { throw new Error('Not implemented'); }

    // ─── Baldes ─────────────────────────────────────────────────────────────

    /**
     * @param {{siteCode?: ?string, onlyActive?: boolean}} filters
     * @returns {Promise<object[]>}
     */
    findDinerGroups(filters) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<?object>} */
    findDinerGroupById(id) { throw new Error('Not implemented'); }

    /**
     * @param {object} payload
     * @param {{userId: number, branchCode: string}} actor
     * @returns {Promise<object>}
     */
    insertDinerGroup(payload, actor) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {object} fields - Só as chaves presentes são alteradas.
     * @param {{userId: number, branchCode: string}} actor
     * @returns {Promise<?object>}
     */
    patchDinerGroup(id, fields, actor) { throw new Error('Not implemented'); }

    // ─── Registro de refeição ───────────────────────────────────────────────

    /**
     * Grava a refeição, ou devolve a que já existe com o mesmo `client_uuid`.
     *
     * IDEMPOTENTE por contrato: reenviar não duplica nem estoura erro. É o que
     * torna a fila offline da etapa 3 segura — timeout com reenvio não pode ser
     * tratado como falha nem como refeição nova.
     *
     * @param {object} payload
     * @returns {Promise<{log: object, created: boolean}>}
     *   `created: false` quando o `client_uuid` já estava gravado.
     */
    insertMealLog(payload) { throw new Error('Not implemented'); }

    /** @param {string} clientUuid @returns {Promise<?object>} */
    findMealLogByClientUuid(clientUuid) { throw new Error('Not implemented'); }
}

module.exports = { MealRepositoryPort };
