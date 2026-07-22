const { poolGlobal } = require('../../../config/mysql');
const {
  sqlListVehicles, sqlCountVehicles, sqlGetVehicleById, sqlGetActiveInsuranceByVehicleId
} = require('../repositories/mysql/gapp-vehicle.repository');
const { AppError } = require('../../../errors/app.error');

class GappVehicleService {
  async list(filters) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      const { sql, params } = sqlListVehicles(filters);
      const { sql: countSql, params: countParams } = sqlCountVehicles(filters);
      const [rows] = await conn.query(sql, params);
      const [[{ total }]] = await conn.query(countSql, countParams);
      return { items: rows, total, page: Number(filters.page) || 1, limit: Number(filters.limit) || 20 };
    } catch (error) {
      throw new AppError(error.message, 500);
    } finally {
      if (conn) conn.release();
    }
  }

  async getById(id) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      const [rows] = await conn.query(sqlGetVehicleById(), [id]);
      if (!rows.length) throw new AppError('Veículo não encontrado', 404);

      const vehicle = rows[0];
      const [insuranceRows] = await conn.query(sqlGetActiveInsuranceByVehicleId(), [vehicle.vehicle_id]);
      vehicle.insurance = insuranceRows[0] || null;
      return vehicle;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(error.message, 500);
    } finally {
      if (conn) conn.release();
    }
  }
}

module.exports = { GappVehicleService };
