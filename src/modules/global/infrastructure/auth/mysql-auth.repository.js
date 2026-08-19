/**
 * @fileoverview Adapter MySQL — implementa `AuthRepositoryPort`.
 * @module modules/global/infrastructure/auth/mysql-auth.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { AuthRepositoryPort } = require('../../application/auth/ports/auth-repository.port');

class MysqlAuthRepository extends AuthRepositoryPort {
    async findUserAuthorization(identifier) {
        const conn = await poolGlobal.getConnection();
        try {
            const [rows] = await conn.execute('call sp_get_user_authorization(?);', [identifier]);
            if (rows[0].length === 0) {
                throw new AppError('The user does not have assigned permission.');
            }
            return rows[0][0];
        } finally {
            conn.release();
        }
    }

    async findLocalUserByUsername(username) {
        const conn = await poolGlobal.getConnection();
        try {
            const [rows] = await conn.execute('SELECT * FROM global._user WHERE user = ?', [username]);
            return rows.length > 0 ? rows[0] : null;
        } finally {
            conn.release();
        }
    }

    async findUserByAdGuid(adGuid) {
        const conn = await poolGlobal.getConnection();
        try {
            const [rows] = await conn.execute('SELECT * FROM global._user WHERE ad_guid = ? LIMIT 1', [adGuid]);
            return rows.length > 0 ? rows[0] : null;
        } finally {
            conn.release();
        }
    }

    async upsertAdLogin({ ad_guid, user, name, registration, branch_code, table_protheus }) {
        const conn = await poolGlobal.getConnection();
        try {
            const [rows] = await conn.execute(
                'CALL sp_ad_login_user(?, ?, ?, ?, ?, ?);',
                [ad_guid, user, name, registration, branch_code, table_protheus]
            );

            if (rows[0].length === 0) {
                throw new AppError('User not found');
            }
            if (rows[0][0]?.result !== 'LOGIN_OK') {
                throw new AppError(rows[0][0]?.result);
            }

            return rows[0][0];
        } finally {
            conn.release();
        }
    }

    async findCredentialsById(userId) {
        const conn = await poolGlobal.getConnection();
        try {
            const [rows] = await conn.execute(
                'SELECT id, password, ad_guid FROM global._user WHERE id = ? LIMIT 1',
                [userId]
            );
            return rows.length > 0 ? rows[0] : null;
        } finally {
            conn.release();
        }
    }

    async updatePassword(userId, passwordHash) {
        const conn = await poolGlobal.getConnection();
        try {
            // Trocar a senha sempre desarma a exigência — é exatamente o que a
            // flag estava cobrando. Zerar aqui, e não no caso de uso, garante
            // que nenhum caminho de troca deixe o usuário preso.
            await conn.execute(
                'UPDATE global._user SET password = ?, must_change_password = 0 WHERE id = ?',
                [passwordHash, userId]
            );
        } finally {
            conn.release();
        }
    }

    /**
     * Reset feito pela gestão de acessos: grava a senha temporária e liga a
     * exigência de troca.
     * @returns {Promise<number>} Linhas afetadas — 0 se o id não existir.
     */
    async resetPassword(userId, passwordHash) {
        const conn = await poolGlobal.getConnection();
        try {
            const [result] = await conn.execute(
                'UPDATE global._user SET password = ?, must_change_password = 1 WHERE id = ?',
                [passwordHash, userId]
            );
            return result.affectedRows ?? 0;
        } finally {
            conn.release();
        }
    }
}

module.exports = { MysqlAuthRepository };
