const { poolGlobal } = require('../../../config/mysql');
const { AppError } = require('../../../errors/app.error');

class Employee {
    constructor(id = 0) {
        this.id = id;
    }
    async getEmployeePhoto() {
        try {

            const [rows] = await poolGlobal.execute(
                "SELECT photo FROM _employee WHERE id = ?",
                [this.id]
            );

            if (!rows.length || !rows[0].photo) {
                throw new Error("Photo not found");
            }

            return rows[0].photo;
        } catch (error) {
            throw new AppError(
                error.sqlMessage,
                500,              // status HTTP
                error.code,       // código MySQL
                error
            );
        }
    }
    async updateEmployeePhoto(imageBuffer) {
        try {
            const [result] = await poolGlobal.execute(
                "UPDATE global._employee SET photo = ? WHERE id = ?",
                [imageBuffer, this.id]
            );

            if (result.affectedRows === 0) {
                throw new AppError("Employee not found", 404);
            }

        } catch (error) {
            throw new AppError(
                error.sqlMessage || error.message,
                500,
                error.code,
                error
            );
        }
    }
}

module.exports = { Employee };