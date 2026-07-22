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
            const { sql: emplSql, params: emplParams } = sqlMapUserWithOrganization(userData.registration);
            const emplRequest = pool.request();
            for (const [key, value] of Object.entries(emplParams)) {
                emplRequest.input(key, value);
            }
            const empl = await emplRequest.query(emplSql);
            return this.mapUserWithOrganization(userData, empl.recordset[0]);
        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.release();
        }
    }
    _nicknameFromName(name) {
        if (!name) return null;
        const parts = name.trim().split(/\s+/);
        return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
    }

    mapUserWithOrganization(user, orgData = {}) {
        const name = user.name?.trim() ?? null;
        return {
            // USER
            id: user.id,
            username: user.user,
            name,
            nickname: this._nicknameFromName(name),
            registration: user.registration,
            status: user.ad_status,

            roles: user.roles ? user.roles.split(',') : [],
            permissions: user.permissions ? user.permissions.split(',') : [],
            application_ids: user.application_ids
                ? user.application_ids.split(',').map(Number)
                : [],

            // COMPANY
            company_code: orgData.M0_CODIGO?.trim() ?? null,
            company_name: orgData.M0_NOMECOM?.trim() ?? null,

            // BRANCH
            branch_code: orgData.M0_CODFIL?.trim() || user.branch_code,
            branch_name: orgData.M0_FILIAL?.trim() ?? null,

            // COST CENTER
            cost_center_code: orgData.CTT_CUSTO?.trim() ?? null,
            cost_center_description: orgData.CTT_DESC01?.trim() ?? null
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
            if (rows.length === 0) {
                throw new UnauthorizedError('Usuário não encontrado');
            }
            if (!await this.authenticatePassword(password, rows[0].password)) {
                throw new UnauthorizedError('Senha incorreta');
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

            // Verifica se o usuário já existe no MySQL pelo GUID do AD
            const existingUser = await this.findUserByAdGuid(auth.guid);

            if (existingUser) {
                // Usuário já mapeado — atualiza senha e retorna sem consultar o Protheus
                const knownUser = new User({
                    user: username,
                    name: existingUser.name,
                    registration: existingUser.registration,
                    branch_code: existingUser.branch_code,
                    table_protheus: existingUser.table_protheus,
                    ad_guid: auth.guid
                });
                await knownUser.setPassword(password);
                await this.spGlobalAdLogin(knownUser);
                return auth;
            }

            // Primeiro login — busca dados no Protheus
            const protheusEmployeeData = await this.getProtheusEmployeeData(auth.name);
            const employee = protheusEmployeeData[0];
            const newUser = new User({
                user: username,
                name: employee['RA_NOME'],
                registration: employee['RA_MAT'],
                branch_code: employee['M0_CODFIL'],
                table_protheus: employee['TABELA'],
                ad_guid: auth.guid
            });

            await newUser.setPassword(password);
            await this.spGlobalAdLogin(newUser);
            return auth;
        } catch (err) {
            if (err.message?.includes("Invalid Credentials")) {
                throw new UnauthorizedError("Usuário ou senha inválidos no Active Directory");
            }
            if (err.message?.includes("LDAP") || err.message?.includes("connect")) {
                throw new AppError("Serviço de autenticação (AD) indisponível", 503);
            }
            throw err;
        }
    }

    async findUserByAdGuid(ad_guid) {
        let conn;
        try {
            conn = await poolGlobal.getConnection();
            const [rows] = await conn.execute(
                "SELECT * FROM global._user WHERE ad_guid = ? LIMIT 1",
                [ad_guid]
            );
            return rows.length > 0 ? rows[0] : null;
        } catch (err) {
            throw err;
        } finally {
            if (conn) conn.release();
        }
    }
    //sqlEmployeeData
    async getProtheusEmployeeData(name) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input("name", sql.NVarChar(200), name)
                .query(sqlEmployeeData()); // chama a função
            console.log(`[AD] getProtheusEmployeeData name="${name}" total=${result.recordset?.length}`, JSON.stringify(result.recordset));
            if (!result.recordset || result.recordset.length === 0) {
                throw new AppError(`Colaborador "${name}" não encontrado no Protheus`, 404);
            }
            if (result.recordset.length > 1) {
                throw new AppError(`Múltiplos colaboradores encontrados no Protheus para o nome "${name}". Entre em contato com o suporte.`, 409);
            }
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