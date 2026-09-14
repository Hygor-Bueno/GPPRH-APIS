/**
 * @fileoverview Casos de uso do cadastro de papéis do painel (`meipp_users`).
 *
 * Não há login aqui. Quem autentica é a sessão por cookie do módulo global;
 * este cadastro só concede papel (`admin`/`editor`/`viewer`) a um usuário que
 * já existe lá, amarrado por `global_user_id`. Ver o cabeçalho de
 * `repositories/mysql/meipp-user.queries.js`.
 *
 * @module modules/global/application/meipp/user/meipp-user.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { normalizePagination, optionalFlag, paginated } = require('../../../domain/meipp/pagination.rules');

class MeippUserUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/meipp-user-repository.port').MeippUserRepositoryPort} deps.repository
     */
    constructor({ repository }) {
        this.repository = repository;
    }

    /** @private */
    async _requireUser(id) {
        const user = await this.repository.findById(id);
        if (!user) throw new AppError('Usuário do meipp não encontrado.', 404);
        return user;
    }

    /**
     * Resolve o papel de quem está na sessão. É o que o middleware de papel
     * chama a cada requisição administrativa.
     *
     * @param {number} globalUserId
     * @returns {Promise<object|null>} `null` quando a pessoa não tem acesso ao módulo.
     */
    async resolveAccess(globalUserId) {
        if (!globalUserId) return null;
        return this.repository.findByGlobalUserId(globalUserId);
    }

    async list(query = {}) {
        const pagination = normalizePagination(query);
        const { rows, total } = await this.repository.list({
            ...pagination,
            active: optionalFlag(query.active),
        });
        return paginated(rows, total, pagination);
    }

    async getById(id) {
        return this._requireUser(id);
    }

    async create(payload) {
        const id = await this.repository.create({
            global_user_id: payload.global_user_id ?? null,
            name: payload.name,
            email: payload.email,
            role: payload.role,
            active: payload.active === undefined ? 1 : Number(payload.active),
        });
        return this.repository.findById(id);
    }

    async update(id, payload) {
        const current = await this._requireUser(id);

        await this.repository.update(id, {
            global_user_id: payload.global_user_id === undefined
                ? current.global_user_id
                : payload.global_user_id,
            name: payload.name ?? current.name,
            email: payload.email ?? current.email,
            role: payload.role ?? current.role,
            active: payload.active === undefined ? current.active : Number(payload.active),
        });

        return this.repository.findById(id);
    }

    /**
     * Desativa em vez de apagar.
     *
     * `meipp_media.uploaded_by` e os `created_by` de playlist, agendamento e
     * comando são ON DELETE SET NULL: remover a linha apagaria a autoria de
     * todo o histórico da pessoa, que é exatamente o que a auditoria existe
     * para preservar.
     *
     * @param {number} id
     * @param {object} currentUser - usuário meipp da sessão.
     */
    async deactivate(id, currentUser) {
        const user = await this._requireUser(id);

        if (currentUser && Number(currentUser.id) === Number(user.id)) {
            throw new AppError('Você não pode desativar o seu próprio acesso.', 400);
        }

        await this.repository.deactivate(id);
        return { id: Number(id), active: 0 };
    }
}

module.exports = { MeippUserUseCases };
