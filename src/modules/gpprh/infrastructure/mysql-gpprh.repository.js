const { poolGpprh } = require('../../../config/mysql');
const { AppError } = require('../../../errors/app.error');
const { GpprhRepositoryPort } = require('../application/ports/gpprh-repository.port');
const { sqlUsers, spAdLoginUser, spCandidateLogin } = require('../repositories/user.queries');

/**
 * @implements {GpprhRepositoryPort}
 */
class MysqlGpprhRepository extends GpprhRepositoryPort {
    async getUser(identifier) {
        const conn = await poolGpprh.getConnection();
        try {
            const [rows] = await conn.execute(sqlUsers(), [identifier]);
            if (rows[0].length === 0) {
                throw new Error('User not found');
            }
            return rows[0][0];
        } finally {
            conn.release();
        }
    }

    async spAdLogin(identifier, name, email = null) {
        const conn = await poolGpprh.getConnection();
        try {
            const [rows] = await conn.execute(spAdLoginUser(), [identifier, name, email]);
            if (rows[0][0]?.result !== 'LOGIN_OK') {
                throw new AppError(rows[0][0]?.result);
            } else if (rows[0].length === 0) {
                throw new AppError('User not found');
            }
        } finally {
            conn.release();
        }
    }

    async spCandidateLogin(name, email) {
        const conn = await poolGpprh.getConnection();
        try {
            const [rows] = await conn.execute(spCandidateLogin(), [name, email]);
            if (rows[0].length === 0) {
                throw new AppError('User not found');
            }
            return rows[0][0];
        } finally {
            conn.release();
        }
    }
}

module.exports = { MysqlGpprhRepository };
