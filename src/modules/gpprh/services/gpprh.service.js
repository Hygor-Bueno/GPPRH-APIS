const {poolGpprh, poolGlobal} = require('../../../config/mysql');
const { AppError } = require('../../../errors/app.error');
const { sqlUsers, spAdLoginUser, sqlCandidate, spCandidateLogin } = require('../repositories/user.repository');

class GpprhService {
    constructor(identifier) {
        this.identifier = identifier;
    }

    async getUser() {
        let conn;
        try {
            conn = await poolGpprh.getConnection();

            const [rows] = await conn.execute(
                sqlUsers(),
                [this.identifier]
            );
            if (rows[0].length === 0) {
                throw new Error('User not found');
            }
            return rows[0][0];
        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.release();
        }
    }
    async getGlobalUser() {
        let conn;
        try {
            conn = await poolGlobal.getConnection();

            const [rows] = await conn.execute(
                sqlUsers(),
                [this.identifier]
            );
            if (rows[0].length === 0) {
                throw new Error('User not found');
            }
            return rows[0][0];
        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.release();
        }
    }
    async getCandidates() {
        let conn;
        try {
            conn = await poolGpprh.getConnection();

            const [rows] = await conn.execute(
                sqlCandidate(),
                [this.identifier]
            );
            if (rows[0].length === 0) {
                throw new Error('User not found');
            }
            return rows[0][0];
        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.release();
        }
    }

    /**
     * Hygor Bueno
     * 
     * @param {string} name 
     * @param {string|null} email
     * @returns 
     */
    async spAdLogin(name, email = null) {
        let conn;
        try {
            conn = await poolGpprh.getConnection();
            const [rows] = await conn.execute(
                spAdLoginUser(),
                [this.identifier, name, email]
            );
            if(rows[0][0]?.result !== 'LOGIN_OK'){
                throw new AppError(rows[0][0]?.result);
            }else if (rows[0].length === 0) {
                throw new AppError('User not found');
            }
        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.release();
        }
    }
    async spGlobalAdLogin(name) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();

            const [rows] = await conn.execute(
                "call sp_ad_login_user(?, ?);",
                [this.identifier, name]
            );
            if(rows[0][0]?.result !== 'LOGIN_OK'){
                throw new AppError(rows[0][0]?.result);
            }else if (rows[0].length === 0) {
                throw new AppError('User not found');
            }
        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.release();
        }
    }

    async spCandidateLogin(name, email) {
        let conn;
        try {
            conn = await poolGpprh.getConnection();
            const [rows] = await conn.execute(
                spCandidateLogin(),
                [name, email]
            );
            if (rows[0].length === 0) {
                throw new AppError('User not found');
            }
            return rows[0][0];
        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.release();
        }
    }
}

module.exports = { GpprhService };