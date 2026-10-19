/**
 * @fileoverview Casos de uso dos espaços da REPP.
 *
 * Cada espaço sai com as flags e os limites de quem consulta, para o front
 * decidir o que mostrar sem regra própria:
 *
 *   can_view_details / can_manage / can_review → administra o espaço (ou é dono)
 *   can_book          → está logado (qualquer um pode pedir reserva)
 *   requires_approval → está logado e NÃO administra: a reserva nasce pendente
 *
 *   blocked_weekdays     → dias da semana sem reserva comum (ISO, igual para todos)
 *   unblocked_dates      → datas desses dias que o administrador liberou (de hoje em diante)
 *   setup_minutes        → folga livre exigida antes e depois de cada reserva
 *   min_booking_at       → primeiro início aceito (`null` = sem limite: administra)
 *   max_booking_date     → última data aceita (`null` = sem limite: administra)
 *   booking_rules_exempt → administra: dias bloqueados, 24h e 2 meses não valem para ele
 *   can_manage_admins    → dono do sistema: adiciona e remove administradores
 *   can_edit_space       → dono do sistema: muda nome, descrição e situação
 *   can_edit_agenda      → administra: muda dias bloqueados e folga
 *   active               → `false` só aparece em `/me/managed?include_inactive=true`
 *
 * Administradores do espaço: `domain/repp/space-admin.rules`.
 * Cadastro (criar, editar, desativar): `domain/repp/space.rules`.
 *
 * Regras em `domain/repp/booking-window.rules`.
 *
 * @module modules/global/application/repp/space/repp-space.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { ReppErrorCode } = require('../../../domain/repp/repp.enums');
const { normalizeDate, parseId } = require('../../../domain/repp/booking.rules');
const { bookingLimits, assertUnblockable, toLocalDate, isoWeekday } = require('../../../domain/repp/booking-window.rules');
const { canReviewSpace } = require('../../../domain/repp/booking-access.rules');
const { canManageAdmins, assertAdminCandidate, assertAdminRemovable } = require('../../../domain/repp/space-admin.rules');
const { canManageSpaces, canEditSpaceAgenda, normalizeNewSpace, spaceChanges, assertCanEditSpace } = require('../../../domain/repp/space.rules');
const { resolveViewer } = require('../repp-viewer');

const spaceNotFound = () => new AppError('Espaço não encontrado.', 404, { code: ReppErrorCode.SpaceNotFound });

class ReppSpaceUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/repp-space-repository.port').ReppSpaceRepositoryPort} deps.spaceRepository
     * @param {() => Date} [deps.clock] - injetável nos testes.
     */
    constructor({ spaceRepository, clock = () => new Date() }) {
        this.spaceRepository = spaceRepository;
        this.clock = clock;
    }

    /** @private */
    _shape(space, viewer, now, unblockedDates) {
        const admin = canReviewSpace(viewer, space.id);
        const limits = bookingLimits(space, admin, now);
        const bookable = viewer.authenticated && space.active;
        return {
            id: Number(space.id),
            name: space.name,
            description: space.description ?? null,
            active: space.active,
            can_view_details: admin,
            can_manage: admin,
            can_review: admin,
            can_book: bookable,
            requires_approval: bookable && !admin,
            blocked_weekdays: limits.blocked_weekdays,
            // Data liberada de um dia que deixou de ser bloqueado não tem efeito: não sai.
            unblocked_dates: (unblockedDates.get(Number(space.id)) ?? [])
                .filter((date) => space.blocked_weekdays.includes(isoWeekday(date))),
            setup_minutes: limits.setup_minutes,
            min_booking_at: limits.min_booking_at,
            max_booking_date: limits.max_booking_date,
            booking_rules_exempt: limits.booking_rules_exempt,
            can_manage_admins: canManageAdmins(viewer),
            can_edit_space: canManageSpaces(viewer),
            can_edit_agenda: canEditSpaceAgenda(viewer, space.id),
        };
    }

    /** @private formata a lista; só consulta datas liberadas de quem bloqueia algum dia. */
    async _shapeAll(spaces, viewer) {
        const now = this.clock();
        const withBlocks = spaces.filter((space) => space.blocked_weekdays.length).map((space) => space.id);
        const unblocked = withBlocks.length
            ? await this.spaceRepository.listUnblockedDates(withBlocks, toLocalDate(now))
            : new Map();
        return spaces.map((space) => this._shape(space, viewer, now, unblocked));
    }

    /** `GET /spaces` — público. */
    async list(user) {
        const [spaces, viewer] = await Promise.all([
            this.spaceRepository.listActive(),
            resolveViewer(this.spaceRepository, user),
        ]);
        return this._shapeAll(spaces, viewer);
    }

    /**
     * `GET /spaces/me/managed[?include_inactive=true]` — os que o usuário
     * administra; dono do sistema = todos. Com `includeInactive`, também os
     * desativados (a tela de gestão reativa por aqui).
     */
    async listManaged(user, { includeInactive = false } = {}) {
        const [spaces, viewer] = await Promise.all([
            includeInactive ? this.spaceRepository.listAll() : this.spaceRepository.listActive(),
            resolveViewer(this.spaceRepository, user),
        ]);
        return this._shapeAll(spaces.filter((space) => canReviewSpace(viewer, space.id)), viewer);
    }

    // ─── Cadastro ───────────────────────────────────────────────────────────

    /**
     * `POST /spaces` — só o dono. Nasce ativo e com os administradores de
     * `admin_user_ids` (pelo menos um, todos ativos). Devolve o espaço como no
     * `GET /spaces`.
     */
    async create({ input, user }) {
        const viewer = await resolveViewer(this.spaceRepository, user);
        if (!canManageSpaces(viewer)) {
            throw new AppError('Somente o dono do sistema pode cadastrar espaços.', 403, { code: ReppErrorCode.ManageSpacesForbidden });
        }
        const space = normalizeNewSpace(input);
        for (const userId of space.admin_user_ids) {
            assertAdminCandidate(await this.spaceRepository.findUserStatus(userId));
        }
        const { admin_user_ids: adminIds, ...columns } = space;
        const id = await this.spaceRepository.createSpace(columns, adminIds, viewer.userId);
        return this._reload(id, user);
    }

    /**
     * `PUT /spaces/:id` — campos ausentes ficam. Dono muda tudo; admin do
     * espaço só `blocked_weekdays` e `setup_minutes`. Só conta o que muda, e
     * sem mudança nada é gravado. Reservas já feitas não são tocadas.
     */
    async update({ id, input, user }) {
        const { space, viewer } = await this._loadSpace(id, user);
        const changes = spaceChanges(space, input);
        assertCanEditSpace(viewer, space.id, Object.keys(changes));
        if (Object.keys(changes).length) await this.spaceRepository.updateSpace(space.id, changes);
        return this._reload(space.id, user);
    }

    /** @private o espaço recém-gravado, no formato do `GET /spaces` (resolve de novo quem consulta). */
    async _reload(id, user) {
        const [space, viewer] = await Promise.all([
            this.spaceRepository.findById(id),
            resolveViewer(this.spaceRepository, user),
        ]);
        if (!space) throw spaceNotFound();
        return (await this._shapeAll([space], viewer))[0];
    }

    /**
     * `POST /spaces/:id/unblocked-dates` — libera para todos uma data de dia
     * da semana bloqueado. Idempotente. Devolve o espaço como no `GET /spaces`.
     */
    async unblockDate({ id, date, user }) {
        const { space, viewer } = await this._requireManaged(id, user);
        const day = normalizeDate(date, 'date');
        assertUnblockable(day, space, this.clock());
        await this.spaceRepository.addUnblockedDate(space.id, day, viewer.userId);
        return (await this._shapeAll([space], viewer))[0];
    }

    /**
     * `DELETE /spaces/:id/unblocked-dates/:date` — volta a bloquear a data.
     * Idempotente. Reservas já feitas nela continuam valendo.
     */
    async reblockDate({ id, date, user }) {
        const { space, viewer } = await this._requireManaged(id, user);
        const day = normalizeDate(date, 'date');
        await this.spaceRepository.removeUnblockedDate(space.id, day);
        return (await this._shapeAll([space], viewer))[0];
    }

    // ─── Administradores do espaço ──────────────────────────────────────────

    /**
     * `GET /spaces/:id/admins` — dono do sistema ou administrador do próprio
     * espaço. Os donos não aparecem na lista (administram todos sem vínculo),
     * salvo quem também foi adicionado ao espaço.
     */
    async listAdmins({ id, user }) {
        const { space, viewer } = await this._loadSpace(id, user);
        if (!canReviewSpace(viewer, space.id)) {
            throw new AppError('Somente o administrador do espaço ou o dono do sistema pode ver os administradores.', 403, { code: ReppErrorCode.NotSpaceAdmin });
        }
        return this._adminList(space, viewer);
    }

    /** `POST /spaces/:id/admins` `{ user_id }` — só o dono. Idempotente. */
    async addAdmin({ id, userId, user }) {
        const { space, viewer } = await this._requireAdminManager(id, user);
        const targetId = this._requireUserId(userId);
        assertAdminCandidate(await this.spaceRepository.findUserStatus(targetId));
        await this.spaceRepository.addAdmin(space.id, targetId, viewer.userId);
        return this._adminList(space, viewer);
    }

    /**
     * `DELETE /spaces/:id/admins/:user_id` — só o dono. Idempotente; recusa
     * deixar o espaço sem administrador ativo (checado sob trava).
     */
    async removeAdmin({ id, userId, user }) {
        const { space, viewer } = await this._requireAdminManager(id, user);
        const targetId = this._requireUserId(userId);
        await this.spaceRepository.removeAdmin(space.id, targetId, (admins) => assertAdminRemovable(admins, targetId));
        return this._adminList(space, viewer);
    }

    /** @private o que as três rotas devolvem. */
    async _adminList(space, viewer) {
        return {
            space_id: space.id,
            can_manage_admins: canManageAdmins(viewer),
            items: await this.spaceRepository.listAdmins(space.id),
        };
    }

    /** @private espaço (ativo ou não) + quem consulta. */
    async _loadSpace(id, user) {
        const spaceId = parseId(id);
        if (!spaceId) throw spaceNotFound();
        const [space, viewer] = await Promise.all([
            this.spaceRepository.findById(spaceId),
            resolveViewer(this.spaceRepository, user),
        ]);
        if (!space) throw spaceNotFound();
        return { space, viewer };
    }

    /** @private */
    async _requireAdminManager(id, user) {
        const loaded = await this._loadSpace(id, user);
        if (!canManageAdmins(loaded.viewer)) {
            throw new AppError('Somente o dono do sistema pode adicionar ou remover administradores de espaço.', 403, { code: ReppErrorCode.ManageAdminsForbidden });
        }
        return loaded;
    }

    /** @private */
    _requireUserId(value) {
        const userId = parseId(value);
        if (!userId) throw new AppError('Usuário não encontrado.', 404, { code: ReppErrorCode.UserNotFound });
        return userId;
    }

    /** @private espaço ativo que o usuário administra (ou é dono). */
    async _requireManaged(id, user) {
        const spaceId = parseId(id);
        if (!spaceId) throw spaceNotFound();
        const [space, viewer] = await Promise.all([
            this.spaceRepository.findById(spaceId),
            resolveViewer(this.spaceRepository, user),
        ]);
        if (!space) throw spaceNotFound();
        if (!space.active) throw new AppError('Este espaço está inativo e não aceita reservas.', 400, { code: ReppErrorCode.SpaceInactive });
        if (!canReviewSpace(viewer, space.id)) {
            throw new AppError('Somente o administrador do espaço ou o dono do sistema pode liberar ou bloquear datas.', 403, { code: ReppErrorCode.NotSpaceAdmin });
        }
        return { space, viewer };
    }
}

module.exports = { ReppSpaceUseCases };
