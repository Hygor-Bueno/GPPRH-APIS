const poolGpprh = require('../../../config/mysql');
const { sqlUsers, spAdLoginUser, sqlCandidate, spCandidateLogin } = require('../repositories/usersRepository');

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
                throw new Error(rows[0][0]?.result);
            }else if (rows[0].length === 0) {
                throw new Error('User not found');
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
                throw new Error('User not found');
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