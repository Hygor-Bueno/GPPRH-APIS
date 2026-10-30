const SQL_VIEW_MAITENANCE = `SELECT * FROM global.gapp_maintenance_process`;

const SQL_VIEW_MAITENANCE_LOGS_BY_ID = `SELECT * FROM global.gapp_maintenance_process_logs WHERE maint_process_id_fk = ?`;

const SQL_CREATE_MAITENANCE = `INSERT INTO global.gapp_maintenance_process (active_id_fk, status_process ) VALUES (?, ?);`;

const SQL_UPDATE_MAITENANCE = `UPDATE global.gapp_maintenance_process SET status_process = ? WHERE maint_process_id = ?`;

const SQL_CREATE_MAITENANCE_LOGS = `INSERT INTO global.gapp_maintenance_process_logs (	maint_process_id_fk, date, description) VALUES (?, ?, ?)`;

const SQL_UPDATE_MAITENANCE_LOGS = `UPDATE global.gapp_maintenance_process_logs SET date = ?, description = ? WHERE process_log_id = ?`;

module.exports = {
    SQL_CREATE_MAITENANCE,
    SQL_CREATE_MAITENANCE_LOGS,
    SQL_UPDATE_MAITENANCE,
    SQL_UPDATE_MAITENANCE_LOGS,
    SQL_VIEW_MAITENANCE,
    SQL_VIEW_MAITENANCE_LOGS_BY_ID
}