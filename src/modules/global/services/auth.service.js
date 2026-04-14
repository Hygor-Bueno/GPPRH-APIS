const { poolGlobal } = require('../../../config/mysql');
const { poolPromise, sql } = require('../../../config/protheus');
const bcrypt = require("bcrypt");
const { AppError } = require('../../../errors/app.error');
const { UnauthorizedError } = require('../../../errors/unauthorized.error');
const LDAPAuthenticator = require('../../../infra/auth/ldap-auth.service');
const { sqlEmployeeData, sqlMapUserWithOrganization } = require('../../protheus/repositories/cost-center.repository');
const { User } = require('../domain/user.entity');

class GlobalService {
    constructor(identifier = null) {
        this.identifier = identifier;
    }
    async getGlobalUserForGuid(id) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();
            const pool = await poolPromise;
            const [rows] = await conn.execute(
                "call sp_get_user_authorization(?);",
                [id]
            );
            if (rows[0].length === 0) {
                throw new AppError('The user does not have assigned permission.');
            }

            const userData = rows[0][0];
            const empl = await pool.request().query(sqlMapUserWithOrganization(userData.registration));
            return this.mapUserWithOrganization(userData, empl.recordset[0]);
        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.release();
        }
    }
    mapUserWithOrganization(user, orgData) {
        return {
            // USER
            id: user.id,
            username: user.user,
            name: user.name?.trim(),
            registration: user.registration,
            status: user.ad_status,

            roles: user.roles ? user.roles.split(',') : [],
            permissions: user.permissions ? user.permissions.split(',') : [],
            application_ids: user.application_ids
                ? user.application_ids.split(',').map(Number)
                : [],

            // COMPANY
            company_code: orgData.M0_CODIGO?.trim(),
            company_name: orgData.M0_NOMECOM?.trim(),

            // BRANCH
            branch_code: orgData.M0_CODFIL?.trim() || user.branch_code,
            branch_name: orgData.M0_FILIAL?.trim(),

            // COST CENTER
            cost_center_code: orgData.CTT_CUSTO?.trim(),
            cost_center_description: orgData.CTT_DESC01?.trim()
        };
    }
    async controlleLogin(username, password) {
        try {
            const adUser = await this.getAdUser(username, password);
            return adUser;
        } catch (err) {
            // se falhar autenticação AD tenta login local
            if (err instanceof UnauthorizedError) {
                return await this.getGlobalUser(username, password);
            }
            throw err;
        }
    }
    async getGlobalUser(username, password) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();
            const [rows] = await conn.execute(
                "SELECT * FROM global._user WHERE user = ?",
                [username]
            );
            if (rows.length === 0 || !await this.authenticatePassword(password, rows[0].password)) {
                throw new UnauthorizedError('Invalid username or password');
            }

            return rows[0];
        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.release();
        }
    }

    async getAdUser(username, password) {
        try {
            const auth = await new LDAPAuthenticator(
                username,
                password
            ).authenticateUser(username, password);
            this.identifier = auth.guid;

            // console.log(`name: ${auth.name}, email: ${auth.email}, guid: ${auth.guid}`);
            const protheusEmployeeData = await this.getProtheusEmployeeData(auth.name);
            const employee = protheusEmployeeData[0];

            // console.log("Dados do funcionário no Protheus:", employee['RA_NOME']);
            const newUser = new User({
                user: username,
                name: employee['RA_NOME'],
                registration: employee['RA_MAT'],
                branch_code: employee['M0_CODFIL'],
                table_protheus: employee['TABELA'],
                ad_guid: auth.guid
            });

            await newUser.setPassword(password);
            const req = await this.spGlobalAdLogin(newUser);
            // console.log(req,' <= spGlobalAdLogin');
            return auth;
        } catch (err) {
            if (err.message?.includes("Invalid Credentials")) {
                throw new UnauthorizedError("Invalid AD credentials");
            }
            throw err;
        }
    }
    //sqlEmployeeData
    async getProtheusEmployeeData(name) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input("name", sql.NVarChar(200), name)
                .query(sqlEmployeeData()); // chama a função
            if (!result.recordset || result.recordset.length > 1) throw new AppError("It was not possible to identify the user");
            return result.recordset;
        } catch (err) {
            console.error("Erro ao buscar dados do funcionário:", err);
            throw err;
        }
    }

    async authenticatePassword(password_param, password_hash) {
        const password = password_param;
        const hash = password_hash;
        let inner_password = '';
        if (hash.startsWith("$2y$")) {
            inner_password = hash.replace("$2y$", "$2b$");
        }
        return await bcrypt.compare(password, inner_password);
    }



    /**
     * Hygor Bueno
     * 
     * @param {string} name 
     * @param {string|null} email
     * @returns 
     */
    async spGlobalAdLogin({
        ad_guid,
        user,
        name,
        registration,
        branch_code,
        table_protheus
    }) {
        let conn;

        try {
            conn = await poolGlobal.getConnection();

            const [rows] = await conn.execute(
                "CALL sp_ad_login_user(?, ?, ?, ?, ?, ?);",
                [
                    ad_guid,
                    user,
                    name,
                    registration,
                    branch_code,
                    table_protheus
                ]
            );

            if (rows[0].length === 0) {
                throw new AppError('User not found');
            }

            if (rows[0][0]?.result !== 'LOGIN_OK') {
                throw new AppError(rows[0][0]?.result);
            }

            return rows[0][0];

        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.release();
        }
    }

}

module.exports = { GlobalService };