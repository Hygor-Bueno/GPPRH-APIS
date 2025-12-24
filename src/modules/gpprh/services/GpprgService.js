const poolGpprh = require('../../../config/mysql');
const { sqlUsers, spAdLoginUser } = require('../repositories/usersRepository');

class GpprgService {
    constructor(ad_guid) {
        this.ad_guid = ad_guid;
    }

    async getUser() {
        let conn;
        try {
            conn = await poolGpprh.getConnection();

            const [rows] = await conn.execute(
                sqlUsers(),
                [this.ad_guid]
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
                [this.ad_guid, name, email]
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
}

module.exports = { GpprgService };