/**
 * @fileoverview Porta (contrato) de persistência MySQL para despesas GAPP.
 *
 * `createExpenseWithDetail`/`updateExpenseWithDetail` são operações atômicas
 * únicas — a transação (begin/commit/rollback) fica inteiramente
 * encapsulada no adapter, o use-case não sabe que é uma transação.
 *
 * @module modules/global/application/gapp/expenses/ports/expenses-repository.port
 */

class ExpensesRepositoryPort {
    /** @param {number} activeId @returns {Promise<{work_group_fk: number}|null>} */
    findActiveWorkGroup(activeId) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<{exp_type_id_fk: number}|null>} */
    findExpenseType(id) { throw new Error('Not implemented'); }

    /**
     * @param {object} expensePayload
     * @param {number} expTypeId
     * @param {object|null} detail
     * @param {number|null} activeId
     * @returns {Promise<{expen_id: number}>}
     */
    createExpenseWithDetail(expensePayload, expTypeId, detail, activeId) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {object} expensePayload
     * @param {number} expTypeId
     * @param {object|null} detail
     * @param {number|null} activeId
     * @returns {Promise<{expen_id: number}>}
     */
    updateExpenseWithDetail(id, expensePayload, expTypeId, detail, activeId) { throw new Error('Not implemented'); }

    /** @param {object} filters */
    list(filters) { throw new Error('Not implemented'); }

    /** @param {object} filters */
    listVehicleExpenses(filters) { throw new Error('Not implemented'); }

    /**
     * @param {number} id
     * @param {number} workGroupFk
     * @returns {Promise<object|null>}
     */
    findExpenseById(id, workGroupFk) { throw new Error('Not implemented'); }
}

module.exports = { ExpensesRepositoryPort };
