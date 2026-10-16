/**
 * @fileoverview Casos de uso das reservas da REPP.
 *
 * ─── Conflito de horário ────────────────────────────────────────────────────
 * Toda escrita que ocupa horário (criar, editar, aprovar) checa a
 * sobreposição DENTRO de `runLocked`: a transação trava a linha do espaço
 * (`SELECT ... FOR UPDATE`) antes de procurar conflito, então duas reservas
 * simultâneas do mesmo espaço entram em fila e a segunda enxerga a primeira.
 * A checagem fora da trava seria só uma corrida com mais passos.
 *
 * O que é lento e externo (Protheus) roda ANTES da trava, para não segurar o
 * espaço enquanto o SQL Server responde.
 *
 * ─── Regras de agenda (`domain/repp/booking-window.rules`) ──────────────────
 * Quem NÃO administra o espaço só reserva com 24h de antecedência, até o
 * mesmo dia daqui a 2 meses e fora dos dias da semana bloqueados no espaço
 * (salvo data liberada pelo administrador). Checadas fora da trava: dependem
 * só do relógio e da configuração do espaço, não de outras reservas.
 *
 * A folga de organização (`setup_minutes`) vale para TODO MUNDO e entra na
 * checagem de conflito, sob a trava, com o valor lido na própria linha
 * travada. A aprovação reconfere só a sobreposição, sem folga: o pedido já
 * passou pela folga ao ser criado, e um pedido anterior à regra não deve
 * ficar impossível de aprovar.
 *
 * Na edição, cada regra só roda sobre o que mudou: antecedência mínima quando
 * muda o início (espaço, data ou hora de início); máxima e dia da semana
 * quando muda o dia (espaço ou data).
 *
 * ─── Autoria ────────────────────────────────────────────────────────────────
 * Quem cria, edita, aprova e cancela sai SEMPRE de `user` (= `req.user`, do
 * cookie) — nunca do corpo. Idem as descrições de empresa/filial/centro de
 * custo, que vêm do Protheus a partir dos códigos.
 *
 * ─── Notificação ────────────────────────────────────────────────────────────
 * Cancelar, aprovar, recusar e editar avisam o CRIADOR quando quem agiu é
 * outra pessoa; reserva que vira pendente avisa os ADMINISTRADORES do espaço
 * (`requested`), e reserva nova que já nasce aprovada também (`created`)
 * (`domain/repp/notification.rules`). Os avisos são gravados em
 * `re_notifications` DENTRO da mesma transação da ação — não existe ação
 * concluída sem aviso — e só depois do commit sai um `repp:event` por
 * destinatário, com o mesmo `id`, sem esperar e sem poder falhar a ação.
 *
 * @module modules/global/application/repp/booking/repp-booking.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { BookingStatus, NotificationAction, ReppErrorCode } = require('../../../domain/repp/repp.enums');
const {
    normalizeDate,
    normalizeTime,
    assertTimeOrder,
    assertNotPast,
    hasStarted,
    normalizeRange,
    normalizeOptionalRange,
    normalizeStatusFilter,
    normalizeText,
    normalizeOrganizationCodes,
    hasOrganizationInput,
    pickOrganizationCodes,
    parseId,
    isOccupying,
    initialStatus,
    isSchedulingChange,
    statusAfterEdit,
    conflictError,
} = require('../../../domain/repp/booking.rules');
const {
    assertAdvance,
    assertWeekdayAllowed,
    isoWeekday,
    setupWindow,
    pickConflict,
} = require('../../../domain/repp/booking-window.rules');
const {
    canReviewSpace,
    canViewDetails,
    canManage,
    isCreator,
    isAnySpaceAdmin,
    detailScope,
} = require('../../../domain/repp/booking-access.rules');
const { shapeMasked, shapeDetailed, compareBookings } = require('../../../domain/repp/booking.shaper');
const { buildCreatorNotice, buildRequestNotices, scheduleOf, toEventPayload } = require('../../../domain/repp/notification.rules');
// Paginação: a mesma do MIEPP (`?page=&limit=`, 50/200), reaproveitada sem cópia.
const { normalizePagination, paginated } = require('../../../domain/shared/pagination.rules');
const { resolveViewer } = require('../repp-viewer');

// Erros que se repetem em mais de um ponto — mesma mensagem e mesmo `code` sempre.
const bookingNotFound = () => new AppError('Reserva não encontrada.', 404, { code: ReppErrorCode.BookingNotFound });
const bookingStale = () => new AppError('A reserva foi alterada por outra pessoa. Atualize a tela e tente de novo.', 409, { code: ReppErrorCode.BookingStale });
const spaceNotFound = () => new AppError('Espaço não encontrado.', 404, { code: ReppErrorCode.SpaceNotFound });
const spaceInactive = () => new AppError('Este espaço está inativo e não aceita reservas.', 400, { code: ReppErrorCode.SpaceInactive });

class ReppBookingUseCases {
    /**
     * @param {object} deps
     * @param {import('./ports/booking-repository.port').BookingRepositoryPort} deps.bookingRepository
     * @param {import('../ports/repp-space-repository.port').ReppSpaceRepositoryPort} deps.spaceRepository
     * @param {import('./ports/organization-directory.port').OrganizationDirectoryPort} deps.organizationDirectory
     * @param {import('./ports/booking-event-publisher.port').BookingEventPublisherPort} deps.eventPublisher
     * @param {() => Date} [deps.clock] - injetável nos testes.
     */
    constructor({ bookingRepository, spaceRepository, organizationDirectory, eventPublisher, clock = () => new Date() }) {
        this.bookingRepository = bookingRepository;
        this.spaceRepository = spaceRepository;
        this.organizationDirectory = organizationDirectory;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
    }

    // ─── Leitura ────────────────────────────────────────────────────────────

    /**
     * `GET /spaces/bookings?start=&end=&space_id=` — público.
     * Só pendentes e aprovadas: recusada e cancelada liberaram o horário.
     */
    async list({ query = {}, user }) {
        const range = normalizeRange(query.start, query.end);
        const spaceId = this._optionalSpaceFilter(query.space_id);
        const viewer = await resolveViewer(this.spaceRepository, user);
        const scope = detailScope(viewer);
        const filter = { ...range, spaceId, scope };

        const [detailed, masked] = await Promise.all([
            this.bookingRepository.listDetailed(filter),
            scope.all ? [] : this.bookingRepository.listMasked(filter),
        ]);

        const now = this.clock();
        const items = [
            ...detailed.map((row) => shapeDetailed(row, viewer, now)),
            ...masked.map(shapeMasked),
        ].sort(compareBookings);

        return { start: range.start, end: range.end, space_id: spaceId, items };
    }

    /**
     * `GET /spaces/bookings/:id` — público. Quem não vê detalhes recebe a
     * versão mascarada, e só de reserva que ocupa horário: recusada e
     * cancelada respondem 404 para ele (não há horário a mostrar).
     */
    async getById({ id, user }) {
        const bookingId = this._requireId(id);
        const row = await this.bookingRepository.findAccessRow(bookingId);
        if (!row) throw bookingNotFound();

        const viewer = await resolveViewer(this.spaceRepository, user);
        if (canViewDetails(viewer, row)) return this._detailed(bookingId, viewer);
        if (!isOccupying(row.status)) throw bookingNotFound();
        return shapeMasked(row);
    }

    /**
     * `GET /spaces/bookings/mine?status=&start=&end=&space_id=&page=&limit=`
     * — as reservas que o usuário criou, em QUALQUER status (é onde ele
     * encontra a que foi recusada ou cancelada), da mais recente para a mais
     * antiga. Sem o teto de 62 dias da agenda: exige login e é paginada.
     */
    async listMine({ query = {}, user }) {
        const statuses = normalizeStatusFilter(query.status);
        const range = normalizeOptionalRange(query.start, query.end);
        const spaceId = this._optionalSpaceFilter(query.space_id);
        const pagination = normalizePagination(query);
        const viewer = await resolveViewer(this.spaceRepository, user);

        const { rows, total } = await this.bookingRepository.listMine({
            userId: viewer.userId,
            statuses,
            ...range,
            spaceId,
            limit: pagination.limit,
            offset: pagination.offset,
        });

        const now = this.clock();
        return paginated(rows.map((row) => shapeDetailed(row, viewer, now)), total, pagination);
    }

    /** `GET /spaces/bookings/pending` — fila de quem administra (dono = todos os espaços). */
    async listPending({ user }) {
        const viewer = await resolveViewer(this.spaceRepository, user);
        if (!isAnySpaceAdmin(viewer)) {
            throw new AppError('Somente administradores de espaço podem ver a fila de aprovação.', 403, { code: ReppErrorCode.NotSpaceAdmin });
        }
        const rows = await this.bookingRepository.listPending({ all: viewer.isOwner, spaceIds: [...viewer.managed] });
        const now = this.clock();
        return rows
            .filter((row) => !hasStarted(row, now))
            .map((row) => shapeDetailed(row, viewer, now));
    }

    // ─── Escrita ────────────────────────────────────────────────────────────

    /**
     * `POST /spaces/bookings` — qualquer logado. Administrador do espaço e
     * dono do sistema reservam direto (`approved`) e sem as regras de
     * antecedência e dia da semana; os demais, `pending`.
     */
    async create({ input = {}, user }) {
        const viewer = await resolveViewer(this.spaceRepository, user);
        const schedule = this._normalizeSchedule(input);
        const now = this.clock();
        assertNotPast(schedule, now);

        const title = normalizeText(input.title, 'title', { max: 150, required: true });
        const requesterName = normalizeText(input.requester_name ?? user.name, 'requester_name', { max: 150, required: true });

        const space = await this._requireActiveSpace(schedule.space_id);
        const autoApproved = canReviewSpace(viewer, schedule.space_id);
        if (!autoApproved) await this._assertBookingWindow(schedule, space, now);

        // O que não vier no corpo sai da sessão (carimbada no login pelo Protheus).
        const organization = await this._resolveOrganization(pickOrganizationCodes(input, user));

        // Toda reserva nova avisa quem administra o espaço: `requested` se
        // entra na fila, `created` se já nasce aprovada (quem criou não recebe).
        const adminIds = await this.spaceRepository.findAdminIds(schedule.space_id);

        const { id, notices, noticeIds } = await this.bookingRepository.runLocked([schedule.space_id], async (tx) => {
            this._assertLockedSpaceActive(tx, schedule.space_id);
            await this._assertNoConflict(tx, schedule, 0);
            const bookingId = await tx.insert({
                ...schedule,
                ...organization,
                title,
                requester_name: requesterName,
                status: initialStatus(autoApproved),
                reviewed_by: autoApproved ? viewer.userId : null,
                created_by: viewer.userId,
            });
            const requests = buildRequestNotices({
                booking: { id: bookingId, ...schedule, space_name: space.name, title, requester_name: requesterName },
                adminIds,
                actor: user,
                action: autoApproved ? NotificationAction.Created : NotificationAction.Requested,
            });
            return { id: bookingId, notices: requests, noticeIds: await this._insertNotices(tx, requests) };
        });

        this._publish(noticeIds, notices);
        return this._detailed(id, viewer);
    }

    /**
     * `PUT /spaces/bookings/:id` — administrador do espaço, dono ou criador.
     * Campos ausentes ficam como estão. Trocar espaço/data/horário sem poder
     * aprovar no espaço de destino devolve a reserva para `pending`.
     */
    async update({ id, input = {}, user }) {
        const bookingId = this._requireId(id);
        const viewer = await resolveViewer(this.spaceRepository, user);
        const current = await this._requireManageable(bookingId, viewer);

        const next = this._normalizeSchedule({
            space_id: input.space_id ?? current.space_id,
            booking_date: input.booking_date ?? current.booking_date,
            start_time: input.start_time ?? current.start_time,
            end_time: input.end_time ?? current.end_time,
        });
        const scheduling = isSchedulingChange(current, next);
        const now = this.clock();
        if (scheduling) assertNotPast(next, now);
        const targetSpace = scheduling ? await this._requireActiveSpace(next.space_id) : null;
        const nextSpaceName = targetSpace?.name ?? current.space_name;
        if (scheduling && !canReviewSpace(viewer, next.space_id)) {
            const dayChanged = next.space_id !== current.space_id || next.booking_date !== current.booking_date;
            await this._assertBookingWindow(next, targetSpace, now, {
                checkStart: dayChanged || next.start_time !== current.start_time,
                checkDate: dayChanged,
            });
        }

        const title = input.title === undefined
            ? current.title
            : normalizeText(input.title, 'title', { max: 150, required: true });
        const requesterName = input.requester_name === undefined
            ? current.requester_name
            : normalizeText(input.requester_name, 'requester_name', { max: 150, required: true });

        const organization = hasOrganizationInput(input)
            ? await this._resolveOrganization(pickOrganizationCodes(input, current))
            : {
                company_code: current.company_code,
                company_name: current.company_name,
                branch_code: current.branch_code,
                branch_name: current.branch_name,
                cost_center_code: current.cost_center_code,
                cost_center_description: current.cost_center_description,
            };

        const status = statusAfterEdit({
            current,
            next,
            canReviewTarget: canReviewSpace(viewer, next.space_id),
        });

        // Qualquer alteração feita por outra pessoa avisa o criador, com o
        // espaço, a data e o horário como ficaram.
        const after = { ...current, ...next, space_name: nextSpaceName, title, requester_name: requesterName };
        const previous = scheduling ? scheduleOf(current) : null;
        const notices = [
            buildCreatorNotice({ booking: after, action: NotificationAction.Updated, actor: user, previous }),
            // Remarcação que volta para a fila avisa quem administra o espaço de destino.
            ...(status === BookingStatus.Pending && scheduling && !canReviewSpace(viewer, next.space_id)
                ? buildRequestNotices({ booking: after, adminIds: await this.spaceRepository.findAdminIds(next.space_id), actor: user, previous })
                : []),
        ].filter(Boolean);

        const noticeIds = await this.bookingRepository.runLocked([current.space_id, next.space_id], async (tx) => {
            this._assertLockedSpaceActive(tx, next.space_id);
            if (scheduling) await this._assertNoConflict(tx, next, bookingId);
            const affected = await tx.update(bookingId, {
                ...next,
                ...organization,
                title,
                requester_name: requesterName,
                status,
                reset_review: status !== current.status,
                updated_by: viewer.userId,
                expected_status: current.status,
            });
            if (!affected) throw bookingStale();
            return this._insertNotices(tx, notices);
        });

        this._publish(noticeIds, notices);
        return this._detailed(bookingId, viewer);
    }

    /**
     * `PATCH /spaces/bookings/:id/cancel` — administrador do espaço, dono ou
     * criador. Nada é apagado. Em transação para que o aviso ao criador seja
     * gravado junto com o cancelamento.
     */
    async cancel({ id, reason, user }) {
        const bookingId = this._requireId(id);
        const viewer = await resolveViewer(this.spaceRepository, user);
        const current = await this._requireManageable(bookingId, viewer);
        const cancelReason = normalizeText(reason, 'reason', { max: 255 });
        const notices = [buildCreatorNotice({ booking: current, action: NotificationAction.Canceled, actor: user, reason: cancelReason })].filter(Boolean);

        const noticeIds = await this.bookingRepository.runLocked([current.space_id], async (tx) => {
            const affected = await tx.cancel(bookingId, { canceled_by: viewer.userId, cancel_reason: cancelReason });
            if (!affected) throw bookingStale();
            return this._insertNotices(tx, notices);
        });

        this._publish(noticeIds, notices);
        return this._detailed(bookingId, viewer);
    }

    /**
     * `PATCH /spaces/bookings/:id/approve`. Reconfere o conflito com a trava:
     * pendente já ocupa o horário, mas a conferência é barata e cobre
     * qualquer escrita que tenha furado a regra (script manual, por exemplo).
     * Só sobreposição, sem a folga de organização (ver o cabeçalho).
     */
    async approve({ id, user }) {
        const bookingId = this._requireId(id);
        const viewer = await resolveViewer(this.spaceRepository, user);
        const current = await this._requireReviewable(bookingId, viewer);
        const notices = [buildCreatorNotice({ booking: current, action: NotificationAction.Approved, actor: user })].filter(Boolean);

        const noticeIds = await this.bookingRepository.runLocked([current.space_id], async (tx) => {
            await this._assertNoConflict(tx, current, bookingId, { withSetup: false });
            const affected = await tx.review(bookingId, {
                status: BookingStatus.Approved,
                reviewed_by: viewer.userId,
                review_note: null,
            });
            if (!affected) throw bookingStale();
            return this._insertNotices(tx, notices);
        });

        this._publish(noticeIds, notices);
        return this._detailed(bookingId, viewer);
    }

    /** `PATCH /spaces/bookings/:id/reject` — motivo opcional. Libera o horário. */
    async reject({ id, reason, user }) {
        const bookingId = this._requireId(id);
        const viewer = await resolveViewer(this.spaceRepository, user);
        const current = await this._requireReviewable(bookingId, viewer);
        const reviewNote = normalizeText(reason, 'reason', { max: 255 });
        const notices = [buildCreatorNotice({ booking: current, action: NotificationAction.Rejected, actor: user, reason: reviewNote })].filter(Boolean);

        const noticeIds = await this.bookingRepository.runLocked([current.space_id], async (tx) => {
            const affected = await tx.review(bookingId, {
                status: BookingStatus.Rejected,
                reviewed_by: viewer.userId,
                review_note: reviewNote,
            });
            if (!affected) throw bookingStale();
            return this._insertNotices(tx, notices);
        });

        this._publish(noticeIds, notices);
        return this._detailed(bookingId, viewer);
    }

    // ─── Apoio ──────────────────────────────────────────────────────────────

    /** @private grava os avisos na transação da ação; devolve os ids na mesma ordem. */
    async _insertNotices(tx, notices) {
        const ids = [];
        for (const notice of notices) ids.push(await tx.insertNotification(notice));
        return ids;
    }

    /**
     * @private um `repp:event` por destinatário, depois do commit. Não espera e
     * não pode falhar a ação: o aviso já está gravado e chega pelo GET.
     */
    _publish(noticeIds, notices) {
        notices.forEach((notice, index) => {
            const id = noticeIds[index];
            if (!id) return;
            Promise.resolve()
                .then(() => this.eventPublisher.publish(notice.user_id, toEventPayload(id, notice)))
                .catch((error) => console.error(`[repp:event] Failed to publish notification id=${id}:`, error?.message));
        });
    }

    /** @private */
    _requireId(value) {
        const id = parseId(value);
        if (!id) throw bookingNotFound();
        return id;
    }

    /** @private */
    _optionalSpaceFilter(value) {
        if (value === undefined || value === null || value === '') return null;
        const id = parseId(value);
        if (!id) throw new AppError("O parâmetro 'space_id' deve ser um id válido.", 400, { code: ReppErrorCode.InvalidSpaceId });
        return id;
    }

    /** @private espaço, data e horário normalizados e em ordem. */
    _normalizeSchedule(input) {
        const spaceId = parseId(input.space_id);
        if (!spaceId) throw new AppError("O campo 'space_id' é obrigatório e deve ser um id válido.", 400, { code: ReppErrorCode.InvalidSpaceId });
        const schedule = {
            space_id: spaceId,
            booking_date: normalizeDate(input.booking_date, 'booking_date'),
            start_time: normalizeTime(input.start_time, 'start_time'),
            end_time: normalizeTime(input.end_time, 'end_time'),
        };
        assertTimeOrder(schedule.start_time, schedule.end_time);
        return schedule;
    }

    /** @private pré-checagem fora da trava, para responder 404/400 antes de ir ao Protheus. */
    async _requireActiveSpace(spaceId) {
        const space = await this.spaceRepository.findById(spaceId);
        if (!space) throw spaceNotFound();
        if (!space.active) throw spaceInactive();
        return space;
    }

    /** @private a mesma checagem, agora valendo — com a linha travada. */
    _assertLockedSpaceActive(tx, spaceId) {
        const space = tx.spaces.get(spaceId);
        if (!space) throw spaceNotFound();
        if (!space.active) throw spaceInactive();
    }

    /**
     * @private antecedência e dia da semana — só para quem não administra o
     * espaço. Vai ao banco (data liberada) só quando o dia está bloqueado.
     */
    async _assertBookingWindow(schedule, space, now, { checkStart = true, checkDate = true } = {}) {
        assertAdvance(schedule, now, { checkStart, checkDate });
        if (!checkDate || !space.blocked_weekdays.includes(isoWeekday(schedule.booking_date))) return;
        const unblocked = await this.spaceRepository.isDateUnblocked(space.id, schedule.booking_date);
        assertWeekdayAllowed(schedule, space, unblocked);
    }

    /**
     * @private sobreposição e, com `withSetup`, a folga de organização do
     * espaço (lida na linha travada): procura na janela alargada e recusa
     * com a sobreposição de verdade antes da que só invade a folga.
     */
    async _assertNoConflict(tx, schedule, excludeId, { withSetup = true } = {}) {
        const setupMinutes = withSetup ? (tx.spaces.get(schedule.space_id)?.setup_minutes ?? 0) : 0;
        const rows = await tx.findConflicts({
            space_id: schedule.space_id,
            booking_date: schedule.booking_date,
            ...setupWindow(schedule, setupMinutes),
            exclude_id: excludeId,
        });
        const found = pickConflict(rows, schedule);
        if (!found) return;
        throw conflictError(found.conflict, {
            kind: found.kind,
            setupMinutes,
            blocked: setupWindow(found.conflict, setupMinutes),
        });
    }

    /** @private códigos validados no Protheus + descrições do momento. */
    async _resolveOrganization(rawCodes) {
        const codes = normalizeOrganizationCodes(rawCodes);
        const { company, branch, costCenter } = await this.organizationDirectory.resolve(codes);
        if (!company) throw new AppError('Empresa não encontrada no Protheus.', 400, { code: ReppErrorCode.CompanyNotFound });
        if (!branch) throw new AppError('Filial não encontrada para a empresa informada.', 400, { code: ReppErrorCode.BranchNotFound });
        if (!costCenter) throw new AppError('Centro de custo não encontrado para a empresa informada.', 400, { code: ReppErrorCode.CostCenterNotFound });
        return { ...company, ...branch, ...costCenter };
    }

    /**
     * @private carrega a reserva para editar/cancelar.
     * 403 para quem não tem relação com ela; 400 quando a relação existe mas
     * o estado não permite (já começou, cancelada, recusada).
     */
    async _requireManageable(bookingId, viewer) {
        const current = await this.bookingRepository.findDetailed(bookingId);
        if (!current) throw bookingNotFound();
        if (!canReviewSpace(viewer, current.space_id) && !isCreator(viewer, current)) {
            throw new AppError('Você não tem permissão para alterar esta reserva.', 403, { code: ReppErrorCode.BookingForbidden });
        }
        if (!canManage(viewer, current, this.clock())) {
            throw new AppError('Só é possível alterar ou cancelar reservas pendentes ou aprovadas que ainda não começaram.', 400, { code: ReppErrorCode.BookingNotEditable });
        }
        return current;
    }

    /**
     * @private carrega a reserva para aprovar/recusar. Completa (e não só a
     * linha de acesso): título e solicitante vão no aviso ao criador.
     */
    async _requireReviewable(bookingId, viewer) {
        const current = await this.bookingRepository.findDetailed(bookingId);
        if (!current) throw bookingNotFound();
        if (!canReviewSpace(viewer, current.space_id)) throw new AppError('Somente o administrador do espaço ou o dono do sistema pode aprovar ou recusar esta reserva.', 403, { code: ReppErrorCode.ReviewForbidden });
        if (current.status !== BookingStatus.Pending) {
            throw new AppError('Esta reserva não está aguardando aprovação.', 409, { code: ReppErrorCode.BookingNotPending });
        }
        if (hasStarted(current, this.clock())) {
            throw new AppError('Esta reserva já começou e não pode mais ser aprovada ou recusada.', 400, { code: ReppErrorCode.BookingAlreadyStarted });
        }
        return current;
    }

    /** @private a reserva como ficou, completa, para quem acabou de agir nela. */
    async _detailed(bookingId, viewer) {
        const row = await this.bookingRepository.findDetailed(bookingId);
        if (!row) throw bookingNotFound();
        return shapeDetailed(row, viewer, this.clock());
    }
}

module.exports = { ReppBookingUseCases };
