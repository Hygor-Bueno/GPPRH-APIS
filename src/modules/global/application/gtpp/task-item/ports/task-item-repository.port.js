/**
 * @fileoverview Porta (contrato) de persistência — sub-feature Task Item (GTPP).
 * @module modules/global/application/gtpp/task-item/ports/task-item-repository.port
 */

class TaskItemRepositoryPort {
    /** @param {number} taskId @returns {Promise<object[]>} */
    findByTask(taskId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @returns {Promise<object|null>} */
    findItemById(taskId, itemId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @returns {Promise<number>} */
    findMaxOrder(taskId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @returns {Promise<{initial_date:?string, final_date:?string}|null>} */
    findTaskDates(taskId) { throw new Error('Not implemented'); }

    /**
     * @param {number} taskId
     * @param {{description:string, order:number, yesNo:number, createdBy:number, initialDate:?string, finalDate:?string}} data
     * @returns {Promise<{itemId:number}>}
     */
    insertItem(taskId, data) { throw new Error('Not implemented'); }

    /**
     * Salva um arquivo novo via FileService e vincula ao item.
     * @param {number} taskId @param {number} itemId @param {number} userId
     * @param {Express.Multer.File} file
     * @returns {Promise<{affectedRows:number}>}
     */
    attachFile(taskId, itemId, userId, file) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @returns {Promise<{affectedRows:number}>} */
    clearFile(taskId, itemId) { throw new Error('Not implemented'); }

    /** @param {number} itemId @returns {Promise<{source:'files'|'blob', ...object}|null>} */
    findItemFileInfo(itemId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @returns {Promise<number>} */
    findItemFileId(taskId, itemId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @returns {Promise<Buffer|null>} */
    findItemFileBlob(taskId, itemId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @param {0|1} value @returns {Promise<{affectedRows:number}>} */
    updateCheck(taskId, itemId, value) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @param {-1|0|1|2} yesNo @returns {Promise<{affectedRows:number}>} */
    updateYesNo(taskId, itemId, yesNo) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @param {string} description @returns {Promise<{affectedRows:number}>} */
    updateDescription(taskId, itemId, description) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @param {number|null} assignedTo @returns {Promise<{affectedRows:number}>} */
    updateAssignedTo(taskId, itemId, assignedTo) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @param {number} status @returns {Promise<{affectedRows:number}>} */
    updateStatus(taskId, itemId, status) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @param {string|null} note @returns {Promise<{affectedRows:number}>} */
    updateNote(taskId, itemId, note) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @param {?string} initialDate @param {?string} finalDate @returns {Promise<{affectedRows:number}>} */
    updateDates(taskId, itemId, initialDate, finalDate) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} itemId @returns {Promise<{affectedRows:number}>} */
    softDelete(taskId, itemId) { throw new Error('Not implemented'); }

    /** @param {number} taskId @param {number} order @param {'up'|'down'} direction @returns {Promise<{id:number, order:number}|null>} */
    findAdjacentItem(taskId, order, direction) { throw new Error('Not implemented'); }

    /** @param {number} itemId @param {number} order */
    updateOrder(itemId, order) { throw new Error('Not implemented'); }
}

module.exports = { TaskItemRepositoryPort };
