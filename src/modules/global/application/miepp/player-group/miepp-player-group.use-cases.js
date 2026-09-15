/**
 * @fileoverview Casos de uso de grupos de players (`miepp_player_groups`).
 *
 * @module modules/global/application/miepp/player-group/miepp-player-group.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { normalizePagination, paginated } = require('../../../domain/miepp/pagination.rules');

class MieppPlayerGroupUseCases {
    /**
     * @param {object} deps
     * @param {import('./ports/player-group-repository.port').PlayerGroupRepositoryPort} deps.repository
     * @param {import('../ports/miepp-player-repository.port').MieppPlayerRepositoryPort} deps.playerRepository
     */
    constructor({ repository, playerRepository }) {
        this.repository = repository;
        this.playerRepository = playerRepository;
    }

    /** @private */
    async _requireGroup(id) {
        const group = await this.repository.findById(id);
        if (!group) throw new AppError('Grupo não encontrado.', 404);
        return group;
    }

    async list(query = {}) {
        const pagination = normalizePagination(query);
        const { rows, total } = await this.repository.list(pagination);
        return paginated(rows, total, pagination);
    }

    async getById(id) {
        const group = await this._requireGroup(id);
        const members = await this.repository.findMembers(id);
        return { ...group, members };
    }

    async create(payload) {
        const id = await this.repository.create({
            name: payload.name,
            description: payload.description ?? null,
        });
        return this.repository.findById(id);
    }

    async update(id, payload) {
        const current = await this._requireGroup(id);

        await this.repository.update(id, {
            name: payload.name ?? current.name,
            description: payload.description === undefined ? current.description : payload.description,
        });

        return this.repository.findById(id);
    }

    /**
     * Remove o grupo. Os vínculos em `miepp_player_group_members` caem por
     * CASCADE; os players em si continuam existindo.
     *
     * Um agendamento que mirava este grupo continua na base e simplesmente
     * deixa de alcançar qualquer tela — o `target_id` é polimórfico e não tem
     * FK. Por isso a resposta devolve quantas telas o grupo tinha: é o número
     * que diz ao operador quantas paradas de tocar ele acabou de provocar.
     */
    async remove(id) {
        await this._requireGroup(id);
        const members = await this.repository.findMembers(id);
        await this.repository.remove(id);
        return { id: Number(id), removed_members: members.length };
    }

    /** @private Garante que o player existe antes de mexer no vínculo. */
    async _requirePlayer(playerId) {
        const player = await this.playerRepository.findById(playerId);
        if (!player) throw new AppError('Player não encontrado.', 404);
        return player;
    }

    async addMember(groupId, playerId) {
        await this._requireGroup(groupId);
        await this._requirePlayer(playerId);
        await this.repository.addMember(groupId, playerId);
        return { group_id: Number(groupId), player_id: Number(playerId) };
    }

    async removeMember(groupId, playerId) {
        await this._requireGroup(groupId);
        const removed = await this.repository.removeMember(groupId, playerId);
        if (!removed) throw new AppError('Este player não está no grupo.', 404);
        return { group_id: Number(groupId), player_id: Number(playerId) };
    }
}

module.exports = { MieppPlayerGroupUseCases };
