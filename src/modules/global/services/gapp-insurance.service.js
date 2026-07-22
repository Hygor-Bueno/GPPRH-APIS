const { poolGlobal } = require('../../../config/mysql');
const {
  sqlSaveInsurance, sqlSelectInsuranceIdOut, buildSaveInsuranceParams,
  sqlListInsurance, sqlCountInsurance, sqlGetInsuranceById
} = require('../repositories/mysql/gapp-insurance.repository');
const { AppError } = require('../../../errors/app.error');

class GappInsuranceService {
  async save(data) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      await conn.execute(sqlSaveInsurance(), buildSaveInsuranceParams(data));
      const [[{ id }]] = await conn.query(sqlSelectInsuranceIdOut());
      return { id };
    } catch (error) {
      const status = error.sqlState === '45000' ? 400 : 500;
      throw new AppError(error.sqlMessage || error.message, status);
    } finally {
      if (conn) conn.release();
    }
  }

  async list(filters) {
    let conn;
    try {
      conn = await poolGlobal.getConnection();
      const { sql, params } = sqlListInsurance(filters);
      const { sql: countSql, params: countParams } = sqlCountInsurance(filters);
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
      const [rows] = await conn.query(sqlGetInsuranceById(), [id]);
      if (!rows.length) throw new AppError('Seguro não encontrado', 404);
      return rows[0];
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(error.message, 500);
    } finally {
      if (conn) conn.release();
    }
  }
}

module.exports = { GappInsuranceService };
