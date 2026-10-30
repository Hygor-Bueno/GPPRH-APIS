const { poolGlobal } = require("../../../../config/mysql");
const { AppError } = require("../../../../errors/app.error");
const { MaintenanceProcessRepositoryPorts } = require("../../application/gapp/maintenance-process/ports/maitenance-process.repository-ports");
const { SQL_VIEW_MAITENANCE, SQL_VIEW_MAITENANCE_BY_ID, SQL_CREATE_MAITENANCE, SQL_CREATE_MAITENANCE_LOGS, SQL_UPDATE_MAITENANCE, SQL_UPDATE_MAITENANCE_LOGS, SQL_VIEW_MAITENANCE_LOGS_BY_ID } = require("../../repositories/mysql/gapp-maitenance-process.queries");

class MysqlMaintenanceProcessReposiroty extends MaintenanceProcessRepositoryPorts {
    /** @private */
    async _query(sql, params = []) {
        try {
            return await poolGlobal.query(sql, params);
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(error.message || 'Erro ao acessar o banco de dados.', 500, {
                code: 'GAPP_STORE_MYSQL_ERROR',
                details: error
            });
        }
    }

    async listMaintenanceProcess() {
        const [rows] = await this._query(SQL_VIEW_MAITENANCE)
        return rows
    }

    async listMaintenanceProcessById(id) {
        const [rows] = await this._query(SQL_VIEW_MAITENANCE)
        const logs = await this._query(SQL_VIEW_MAITENANCE_LOGS_BY_ID, id);

        const response = {
            ...rows[0],
            ...(logs && { process_logs: logs[0] })
        }
        return response
    }

    async createMaitenanceProcess(payload) {
        const [result] = await this._query(SQL_CREATE_MAITENANCE, [payload.active_id_fk, payload.status_process]);
        return { maint_process_id: result.insertId };
    }

    async createMaitenanceProcessLogs(payload) {
        const [result] = await this._query(SQL_CREATE_MAITENANCE_LOGS, [payload.maint_process_id, payload.date, payload.description]);
        return { maint_process_logs_id: result.insertId };
    }

    async updateMaitenanceProcess(payload, id) {
        const [result] = await this._query(SQL_UPDATE_MAITENANCE, [payload.status_process, id]);
        return { maint_process_id: id };
    }

    async updateMaitenanceProcessLogs(payload, id) {
        const [result] = await this._query(SQL_UPDATE_MAITENANCE_LOGS, [payload.date, payload.description, id]);
        return { maint_process_logs_id: id };
    }
}

module.exports = { MysqlMaintenanceProcessReposiroty }