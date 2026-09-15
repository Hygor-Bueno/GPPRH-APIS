/**
 * @fileoverview Casos de uso de agendamentos e seus alvos.
 *
 * A decisão de *qual* agendamento vale num instante não está aqui — está em
 * `domain/miepp/schedule/schedule-resolver.rules`, chamada pela sub-feature
 * `device`. Este módulo só cuida do cadastro.
 *
 * @module modules/global/application/miepp/schedule/miepp-schedule.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { TargetType } = require('../../../domain/miepp/miepp.enums');
const { ALL_DAYS } = require('../../../domain/miepp/schedule/days-of-week');
const { normalizePagination, optionalFlag, paginated } = require('../../../domain/miepp/pagination.rules');

class MieppScheduleUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/miepp-schedule-repository.port').MieppScheduleRepositoryPort} deps.repository
     * @param {import('../ports/miepp-playlist-repository.port').MieppPlaylistRepositoryPort} deps.playlistRepository
     */
    constructor({ repository, playlistRepository }) {
        this.repository = repository;
        this.playlistRepository = playlistRepository;
    }

    /** @private */
    async _requireSchedule(id) {
        const schedule = await this.repository.findById(id);
        if (!schedule) throw new AppError('Agendamento não encontrado.', 404);
        return schedule;
    }

    /** @private */
    async _requirePlaylist(playlistId) {
        const playlist = await this.playlistRepository.findById(playlistId);
        if (!playlist) throw new AppError('Playlist não encontrada.', 404);
        return playlist;
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
        const schedule = await this._requireSchedule(id);
        const targets = await this.repository.findTargets(id);
        return { ...schedule, targets };
    }

    /**
     * @private
     * Um agendamento com `start_date` depois de `end_date` (ou `start_time`
     * depois de `end_time`) nunca casa em lugar nenhum. É aceito pelo banco e
     * some do radar — o cadastro parece salvo e a tela nunca toca.
     */
    _assertCoherentWindow({ start_date, end_date, start_time, end_time }) {
        if (start_date && end_date && start_date > end_date) {
            throw new AppError('A data inicial não pode ser posterior à data final.', 400);
        }
        if (start_time && end_time && start_time > end_time) {
            throw new AppError(
                'O horário inicial não pode ser posterior ao final. Janelas que cruzam a meia-noite precisam ser cadastradas como dois agendamentos.',
                400
            );
        }
    }

    async create(payload, actor) {
        await this._requirePlaylist(payload.playlist_id);
        this._assertCoherentWindow(payload);

        const id = await this.repository.create({
            name: payload.name,
            playlist_id: Number(payload.playlist_id),
            priority: Number(payload.priority ?? 0),
            start_date: payload.start_date ?? null,
            end_date: payload.end_date ?? null,
            start_time: payload.start_time ?? null,
            end_time: payload.end_time ?? null,
            days_of_week: payload.days_of_week === undefined ? ALL_DAYS : Number(payload.days_of_week),
            active: payload.active === undefined ? 1 : Number(payload.active),
            created_by: actor?.id ?? null,
        });

        return this.getById(id);
    }

    async update(id, payload) {
        const current = await this._requireSchedule(id);

        const merged = {
            name: payload.name ?? current.name,
            playlist_id: Number(payload.playlist_id ?? current.playlist_id),
            priority: payload.priority === undefined ? current.priority : Number(payload.priority),
            start_date: payload.start_date === undefined ? current.start_date : payload.start_date,
            end_date: payload.end_date === undefined ? current.end_date : payload.end_date,
            start_time: payload.start_time === undefined ? current.start_time : payload.start_time,
            end_time: payload.end_time === undefined ? current.end_time : payload.end_time,
            days_of_week: payload.days_of_week === undefined
                ? current.days_of_week
                : Number(payload.days_of_week),
            active: payload.active === undefined ? current.active : Number(payload.active),
        };

        if (payload.playlist_id !== undefined) {
            await this._requirePlaylist(merged.playlist_id);
        }
        this._assertCoherentWindow(merged);

        await this.repository.update(id, merged);
        return this.getById(id);
    }

    async remove(id) {
        await this._requireSchedule(id);
        await this.repository.remove(id);
        return { id: Number(id) };
    }

    // ─── Alvos ──────────────────────────────────────────────────────────────

    async listTargets(scheduleId) {
        await this._requireSchedule(scheduleId);
        return this.repository.findTargets(scheduleId);
    }

    /**
     * Adiciona um alvo.
     *
     * `target_id` é polimórfico e por isso não tem FK no schema — a existência
     * é conferida aqui. Sem essa checagem, um id errado grava sem reclamar e o
     * agendamento nunca alcança ninguém, sem nenhum sinal de erro.
     */
    async addTarget(scheduleId, payload) {
        await this._requireSchedule(scheduleId);

        const targetType = payload.target_type;

        if (targetType === TargetType.ALL) {
            if (payload.target_id !== undefined && payload.target_id !== null) {
                throw new AppError('Alvo do tipo "all" não aceita "target_id".', 400);
            }

            const id = await this.repository.addTarget(scheduleId, {
                target_type: targetType,
                target_id: null,
            });
            return { id, schedule_id: Number(scheduleId), target_type: targetType, target_id: null };
        }

        const targetId = Number(payload.target_id);
        if (!Number.isInteger(targetId) || targetId <= 0) {
            throw new AppError(`Alvo do tipo "${targetType}" exige um "target_id" válido.`, 400);
        }

        const exists = await this.repository.targetExists(targetType, targetId);
        if (!exists) {
            const label = targetType === TargetType.PLAYER ? 'Player' : 'Grupo';
            throw new AppError(`${label} ${targetId} não encontrado.`, 404);
        }

        const id = await this.repository.addTarget(scheduleId, {
            target_type: targetType,
            target_id: targetId,
        });

        return { id, schedule_id: Number(scheduleId), target_type: targetType, target_id: targetId };
    }

    async removeTarget(scheduleId, targetId) {
        await this._requireSchedule(scheduleId);

        const removed = await this.repository.removeTarget(scheduleId, targetId);
        if (!removed) throw new AppError('Alvo não encontrado neste agendamento.', 404);

        return { id: Number(targetId), schedule_id: Number(scheduleId) };
    }
}

module.exports = { MieppScheduleUseCases };
