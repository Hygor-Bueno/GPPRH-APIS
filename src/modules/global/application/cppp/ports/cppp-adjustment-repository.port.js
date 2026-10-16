/**
 * @fileoverview Porta dos ajustes (`cppp_punch_adjustments`).
 *
 * Compartilhada pelo lançamento e pela análise (a visão tratada lê os ajustes
 * ativos). Os objetos trafegam em camelCase, no formato de
 * `normalizeAdjustment`, mais `id`, autoria e cancelamento.
 *
 * Sem `delete`: ajuste se cancela, e o banco recusa DELETE por trigger.
 *
 * @module modules/global/application/cppp/ports/cppp-adjustment-repository.port
 */

class CpppAdjustmentRepositoryPort {
    /**
     * @param {object} adjustment - saída de `normalizeAdjustment` + `attachmentFileId`.
     * @param {number} createdBy  - `_user.id`.
     * @returns {Promise<number|null>} id; `null` quando a leitura já está
     *          desconsiderada por outro ajuste ativo.
     */
    insert(adjustment, createdBy) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /**
     * @param {number} id @param {number} userId @param {string} reason
     * @returns {Promise<boolean>} `false` se já estava cancelado.
     */
    cancel(id, userId, reason) { throw new Error('Not implemented'); }

    /**
     * Ajustes ATIVOS que tocam o intervalo: dia da ocorrência, batida ou
     * período dentro de `[from, to]`.
     * @param {{from: string, to: string, cpf?: string|null}} filters
     * @returns {Promise<object[]>}
     */
    findActiveInRange(filters) { throw new Error('Not implemented'); }

    /**
     * Todos os ajustes de uma pessoa que tocam um dia, inclusive cancelados,
     * com nome do autor.
     * @param {string} cpf @param {string} day
     * @returns {Promise<object[]>}
     */
    findForDay(cpf, day) { throw new Error('Not implemented'); }

    /**
     * @param {{cpf?: string|null, from?: string|null, to?: string|null, type?: string|null,
     *          includeCanceled: boolean, limit: number, offset: number}} filters
     * @returns {Promise<{rows: object[], total: number}>}
     */
    list(filters) { throw new Error('Not implemented'); }
}

module.exports = { CpppAdjustmentRepositoryPort };
