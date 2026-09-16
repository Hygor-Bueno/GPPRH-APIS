/**
 * @fileoverview Casos de uso de players (painel): CRUD, pareamento, revogação
 * de token, comandos remotos e histórico de status.
 *
 * @module modules/global/application/miepp/player/miepp-player.use-cases
 */

const crypto = require('crypto');

const { AppError } = require('../../../../../errors/app.error');
const { normalizePagination, optionalFlag, paginated } = require('../../../domain/miepp/pagination.rules');

class MieppPlayerUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/miepp-player-repository.port').MieppPlayerRepositoryPort} deps.repository
     * @param {object} deps.pairingService - emite/verifica código de pareamento.
     */
    constructor({ repository, pairingService }) {
        this.repository = repository;
        this.pairingService = pairingService;
    }

    /** @private */
    async _requirePlayer(id) {
        const player = await this.repository.findById(id);
        if (!player) throw new AppError('Player não encontrado.', 404);
        return player;
    }

    async list(query = {}) {
        const pagination = normalizePagination(query);
        const { rows, total } = await this.repository.list({
            ...pagination,
            active: optionalFlag(query.active),
            location_id: query.location_id ? Number(query.location_id) : null,
        });
        return paginated(rows, total, pagination);
    }

    async getById(id) {
        return this._requirePlayer(id);
    }

    /**
     * O `uuid` é gerado aqui, não recebido: é o identificador público da tela
     * e não pode ser escolhido por quem cadastra.
     */
    async create(payload) {
        const created = await this.repository.create({
            uuid: crypto.randomUUID(),
            name: payload.name,
            location_id: payload.location_id ?? null,
            hardware_type: payload.hardware_type,
            resolution: payload.resolution ?? null,
            orientation: payload.orientation,
            mac_address: payload.mac_address ?? null,
            active: payload.active === undefined ? 1 : Number(payload.active),
        });
        return this.repository.findById(created.id);
    }

    async update(id, payload) {
        const current = await this._requirePlayer(id);

        await this.repository.update(id, {
            name: payload.name ?? current.name,
            location_id: payload.location_id === undefined ? current.location_id : payload.location_id,
            hardware_type: payload.hardware_type ?? current.hardware_type,
            resolution: payload.resolution === undefined ? current.resolution : payload.resolution,
            orientation: payload.orientation ?? current.orientation,
            mac_address: payload.mac_address === undefined ? current.mac_address : payload.mac_address,
            active: payload.active === undefined ? current.active : Number(payload.active),
        });

        return this.repository.findById(id);
    }

    /**
     * Soft-delete, como pede o requisito.
     *
     * Os tokens do player são revogados junto: uma tela "removida" que continua
     * respondendo heartbeat e baixando mídia com o token antigo é exatamente o
     * que a remoção deveria impedir.
     */
    async deactivate(id) {
        await this._requirePlayer(id);
        await this.repository.deactivate(id);
        const revoked = await this.repository.revokeDeviceTokens(id);
        return { id: Number(id), active: 0, revoked_tokens: revoked };
    }

    /**
     * Gera o código de pareamento.
     *
     * São 8 dígitos, gravados em `miepp_pairing_codes`: uso único, validade
     * curta e **um só por player** — emitir um novo invalida o anterior. Um
     * código curto o bastante para digitar não tem entropia para carregar
     * assinatura, então o que o protege é isso somado ao `pairLimiter` da rota
     * de pareamento. Ver `infrastructure/miepp/miepp-pairing-code.service.js`.
     *
     * @param {number} id
     * @param {object} [actor] - usuário da sessão (`req.user`), para a trilha.
     */
    async issuePairingCode(id, actor) {
        const player = await this._requirePlayer(id);

        if (Number(player.active) !== 1) {
            throw new AppError('Player inativo não pode ser pareado.', 400);
        }

        return this.pairingService.issue(player.id, actor?.id ?? null);
    }

    /** Revoga todos os tokens vivos — a tela volta a pedir pareamento. */
    async revokeTokens(id) {
        await this._requirePlayer(id);
        const revoked = await this.repository.revokeDeviceTokens(id);
        return { id: Number(id), revoked_tokens: revoked };
    }

    async enqueueCommand(id, payload, actor) {
        const player = await this._requirePlayer(id);

        if (Number(player.active) !== 1) {
            throw new AppError('Player inativo não aceita comandos.', 400);
        }

        const commandId = await this.repository.enqueueCommand({
            player_id: player.id,
            command_type: payload.command_type,
            payload: payload.payload ?? null,
            created_by: actor?.id ?? null,
        });

        return { id: commandId, player_id: player.id, command_type: payload.command_type, status: 'pending' };
    }

    async listCommands(id, query = {}) {
        await this._requirePlayer(id);
        const pagination = normalizePagination(query);
        const rows = await this.repository.listCommands(id, pagination);
        return { items: rows, pagination };
    }

    async listStatusLog(id, query = {}) {
        await this._requirePlayer(id);
        const pagination = normalizePagination(query);
        const { rows, total } = await this.repository.listStatusLog(id, pagination);
        return paginated(rows, total, pagination);
    }
}

module.exports = { MieppPlayerUseCases };
