/**
 * @fileoverview Casos de uso da REPP com fakes em memória.
 *
 * Foco no que é regra de negócio: quem vê o quê, quem reserva direto e quem
 * entra na fila, conflito, volta para pendente na troca de horário e as
 * recusas por permissão. A trava real (FOR UPDATE) é do adapter; aqui o fake
 * só garante que toda checagem de conflito acontece DENTRO de `runLocked`.
 */

const { ReppBookingUseCases } = require('../booking/repp-booking.use-cases');
const { ReppSpaceUseCases } = require('../space/repp-space.use-cases');
const { BookingRepositoryPort } = require('../booking/ports/booking-repository.port');
const { ReppSpaceRepositoryPort } = require('../ports/repp-space-repository.port');
const { OrganizationDirectoryPort } = require('../booking/ports/organization-directory.port');
const { overlaps } = require('../../../domain/repp/booking.rules');
const { OCCUPYING_STATUSES } = require('../../../domain/repp/repp.enums');

const NOW = new Date(2026, 9, 8, 10, 0, 0); // 08/10/2026 10:00 local
const SALA = 1;
const AUDITORIO = 2;

const OWNER = { id: 1, name: 'DONO', permissions: ['SYSTEM_OWNER'] };
const ADMIN_SALA = { id: 9, name: 'MARCELA', permissions: [] };
const ADMIN_AUDITORIO = { id: 476, name: 'CLEONICIA', permissions: [] };
const COMMON = { id: 300, name: 'COMUM', permissions: [], company_code: '02', branch_code: '0201', cost_center_code: '1001' };
const OTHER = { id: 301, name: 'OUTRO', permissions: [] };

const SENSITIVE = ['title', 'requester_name', 'company_code', 'company_name', 'branch_code',
    'branch_name', 'cost_center_code', 'cost_center_description', 'created_by', 'created_by_name'];

class FakeSpaceRepository extends ReppSpaceRepositoryPort {
    constructor() {
        super();
        // Sem regra de agenda por padrão; `withAuditoriumRules` liga a de produção.
        const base = { description: null, blocked_weekdays: [], setup_minutes: 0 };
        this.spaces = new Map([
            [SALA, { ...base, id: SALA, name: 'Sala de Treinamento', active: true }],
            [AUDITORIO, { ...base, id: AUDITORIO, name: 'Auditório', active: true }],
            [3, { ...base, id: 3, name: 'Desativado', active: false }],
        ]);
        this.admins = [[SALA, 9], [AUDITORIO, 476]];
        this.unblocked = new Set();
    }
    async listActive() { return [...this.spaces.values()].filter((s) => s.active); }
    async listAll() { return [...this.spaces.values()]; }
    async findById(id) { return this.spaces.get(Number(id)) || null; }
    async createSpace(space, adminIds) {
        this._assertNameFree(space.name);
        const id = Math.max(...this.spaces.keys()) + 1;
        this.spaces.set(id, { ...space, id, active: true });
        for (const userId of adminIds) this.admins.push([id, userId]);
        return id;
    }
    async updateSpace(id, changes) {
        if ('name' in changes) this._assertNameFree(changes.name, id);
        Object.assign(this.spaces.get(id), changes);
    }
    _assertNameFree(name, exceptId) {
        const taken = [...this.spaces.values()].some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase());
        if (taken) throw Object.assign(new Error('dup'), { statusCode: 409, code: 'REPP_SPACE_NAME_TAKEN' });
    }
    async findManagedSpaceIds(userId) { return this.admins.filter(([, u]) => u === userId).map(([s]) => s); }
    async findAdminIds(spaceId) { return this.admins.filter(([s]) => s === spaceId).map(([, u]) => u); }
    async listUnblockedDates(spaceIds, fromDate) {
        return new Map(spaceIds.map((id) => [id, [...this.unblocked]
            .map((key) => key.split('|')).filter(([s, d]) => Number(s) === id && d >= fromDate).map(([, d]) => d).sort()]));
    }
    async isDateUnblocked(spaceId, date) { return this.unblocked.has(`${spaceId}|${date}`); }
    async addUnblockedDate(spaceId, date) { this.unblocked.add(`${spaceId}|${date}`); }
    async removeUnblockedDate(spaceId, date) { this.unblocked.delete(`${spaceId}|${date}`); }

    // Usuários conhecidos para a gestão de administradores.
    users = new Map([[1, 'active'], [9, 'active'], [476, 'active'], [300, 'active'], [301, 'active'], [302, 'blocked']]);
    async listAdmins(spaceId) {
        return this.admins.filter(([s]) => s === spaceId)
            .map(([, u]) => ({ user_id: u, name: `U${u}`, login: `u${u}`, ad_status: this.users.get(u), since: '2026-10-08T13:59:51', added_by: null, added_by_name: null }));
    }
    async findUserStatus(userId) { return this.users.has(userId) ? { id: userId, ad_status: this.users.get(userId) } : null; }
    async addAdmin(spaceId, userId) {
        if (!this.admins.some(([s, u]) => s === spaceId && u === userId)) this.admins.push([spaceId, userId]);
    }
    async removeAdmin(spaceId, userId, assertRemovable) {
        assertRemovable(this.admins.filter(([s]) => s === spaceId).map(([, u]) => ({ user_id: u, ad_status: this.users.get(u) })));
        const before = this.admins.length;
        this.admins = this.admins.filter(([s, u]) => !(s === spaceId && u === userId));
        return before - this.admins.length;
    }
}

class FakeBookingRepository extends BookingRepositoryPort {
    constructor(spaceRepository) {
        super();
        this.spaceRepository = spaceRepository;
        this.rows = new Map();
        this.nextId = 1;
        this.lockedCalls = [];
        this.conflictProbes = [];
        this.notifications = [];
    }

    seed(row) {
        const id = this.nextId++;
        this.rows.set(id, { id, status: 'approved', title: 'Seed', requester_name: 'Seed', company_code: '02',
            company_name: 'PEG PESE', branch_code: '0201', branch_name: 'LOJA', cost_center_code: '1001',
            cost_center_description: 'RH', created_by: 999, ...row,
            space_name: this.spaceRepository.spaces.get(row.space_id).name });
        return id;
    }

    _inScope(row, scope) {
        return scope.all || scope.spaceIds.includes(row.space_id) || (scope.userId !== null && row.created_by === scope.userId);
    }

    _inRange(row, { start, end, spaceId }) {
        return OCCUPYING_STATUSES.includes(row.status) && row.booking_date >= start && row.booking_date <= end
            && (!spaceId || row.space_id === spaceId);
    }

    async listDetailed(filter) {
        return [...this.rows.values()].filter((r) => this._inRange(r, filter) && this._inScope(r, filter.scope)).map((r) => ({ ...r }));
    }

    async listMasked(filter) {
        return [...this.rows.values()].filter((r) => this._inRange(r, filter) && !this._inScope(r, filter.scope))
            .map(({ id, space_id, space_name, booking_date, start_time, end_time, status }) =>
                ({ id, space_id, space_name, booking_date, start_time, end_time, status }));
    }

    async listPending({ all, spaceIds }) {
        return [...this.rows.values()].filter((r) => r.status === 'pending' && (all || spaceIds.includes(r.space_id)));
    }

    async findAccessRow(id) {
        const r = this.rows.get(id);
        if (!r) return null;
        const { space_id, space_name, booking_date, start_time, end_time, status, created_by } = r;
        return { id, space_id, space_name, booking_date, start_time, end_time, status, created_by };
    }

    async findDetailed(id) { const r = this.rows.get(id); return r ? { ...r } : null; }

    async listMine({ userId, statuses, start, end, spaceId, limit, offset }) {
        const all = [...this.rows.values()]
            .filter((r) => r.created_by === userId && (!statuses || statuses.includes(r.status))
                && (!start || r.booking_date >= start) && (!end || r.booking_date <= end) && (!spaceId || r.space_id === spaceId))
            .sort((a, b) => b.booking_date.localeCompare(a.booking_date) || b.start_time.localeCompare(a.start_time));
        return { rows: all.slice(offset, offset + limit).map((r) => ({ ...r })), total: all.length };
    }

    async runLocked(spaceIds, work) {
        this.lockedCalls.push([...spaceIds]);
        const spaces = new Map(spaceIds.map((id) => [id, this.spaceRepository.spaces.get(id)]).filter(([, s]) => s));
        const tx = {
            spaces,
            findConflicts: async (probe) => {
                this.conflictProbes.push(probe);
                return [...this.rows.values()].filter((r) => r.space_id === probe.space_id
                    && r.booking_date === probe.booking_date && OCCUPYING_STATUSES.includes(r.status)
                    && r.id !== probe.exclude_id && overlaps(r, probe))
                    .sort((a, b) => a.start_time.localeCompare(b.start_time))
                    .map(({ id, start_time, end_time }) => ({ id, start_time, end_time }));
            },
            insert: async (p) => this.seed({ ...p }),
            update: async (id, p) => {
                const r = this.rows.get(id);
                if (r.status !== p.expected_status) return 0;
                const { reset_review, reset_reminder, expected_status, ...fields } = p;
                Object.assign(r, fields, reset_review ? { reviewed_by: null } : {}, reset_reminder ? { reminder_sent_at: null } : {});
                r.space_name = this.spaceRepository.spaces.get(r.space_id).name;
                return 1;
            },
            review: async (id, p) => {
                const r = this.rows.get(id);
                if (r.status !== 'pending') return 0;
                Object.assign(r, p);
                return 1;
            },
            cancel: async (id, { canceled_by, cancel_reason }) => {
                const r = this.rows.get(id);
                if (!r || !OCCUPYING_STATUSES.includes(r.status)) return 0;
                Object.assign(r, { status: 'canceled', canceled_by, cancel_reason });
                return 1;
            },
            insertNotification: async (notice) => {
                this.notifications.push({ id: this.notifications.length + 1, ...notice });
                return this.notifications.length;
            },
        };
        return work(tx);
    }
}

class FakeOrganizationDirectory extends OrganizationDirectoryPort {
    constructor() {
        super();
        this.resolve = jest.fn(async ({ company_code, branch_code, cost_center_code }) => ({
            company: company_code === '02' ? { company_code, company_name: 'PEG PESE' } : null,
            branch: branch_code === '0201' ? { branch_code, branch_name: 'LOJA 1' } : null,
            costCenter: cost_center_code === '1001' ? { cost_center_code, cost_center_description: 'RH' } : null,
        }));
    }
}

function setup(now = NOW) {
    const spaceRepository = new FakeSpaceRepository();
    const bookingRepository = new FakeBookingRepository(spaceRepository);
    const organizationDirectory = new FakeOrganizationDirectory();
    const eventPublisher = { publish: jest.fn(async () => {}) };
    const useCases = new ReppBookingUseCases({ bookingRepository, spaceRepository, organizationDirectory, eventPublisher, clock: () => now });
    const spaces = new ReppSpaceUseCases({ spaceRepository, clock: () => now });
    return { useCases, spaces, bookingRepository, spaceRepository, organizationDirectory, eventPublisher };
}

/** Configuração de produção do Auditório: terça e quinta bloqueadas, 60 min de organização. */
function withAuditoriumRules(ctx) {
    Object.assign(ctx.spaceRepository.spaces.get(AUDITORIO), { blocked_weekdays: [2, 4], setup_minutes: 60 });
    return ctx;
}

const RANGE = { start: '2026-10-05', end: '2026-10-11' };
const VALID = {
    space_id: AUDITORIO, booking_date: '2026-10-09', start_time: '14:00', end_time: '15:00',
    title: 'Reunião', company_code: '02', branch_code: '0201', cost_center_code: '1001',
};

describe('agenda — mascaramento por espaço', () => {
    let ctx;
    beforeEach(() => {
        ctx = setup();
        ctx.bookingRepository.seed({ space_id: SALA, booking_date: '2026-10-09', start_time: '09:00', end_time: '10:00' });
        ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: '2026-10-09', start_time: '09:00', end_time: '10:00' });
    });

    const bySpace = (items, spaceId) => items.find((i) => i.space_id === spaceId);

    it('anônimo vê só horário e status', async () => {
        const { items } = await ctx.useCases.list({ query: RANGE, user: null });
        expect(items).toHaveLength(2);
        for (const item of items) {
            for (const key of SENSITIVE) expect(item).not.toHaveProperty(key);
            expect(item).toMatchObject({ can_view_details: false, can_manage: false, can_review: false });
        }
    });

    it('logado sem permissão vê mascarado', async () => {
        const { items } = await ctx.useCases.list({ query: RANGE, user: COMMON });
        for (const item of items) for (const key of SENSITIVE) expect(item).not.toHaveProperty(key);
    });

    it('admin do Auditório vê o Auditório e não a Sala', async () => {
        const { items } = await ctx.useCases.list({ query: RANGE, user: ADMIN_AUDITORIO });
        expect(bySpace(items, AUDITORIO)).toMatchObject({ title: 'Seed', can_view_details: true, can_manage: true });
        expect(bySpace(items, SALA)).not.toHaveProperty('title');
        expect(bySpace(items, SALA).can_view_details).toBe(false);
    });

    it('dono do sistema vê tudo', async () => {
        const { items } = await ctx.useCases.list({ query: RANGE, user: OWNER });
        expect(items.every((i) => i.can_view_details && i.title === 'Seed')).toBe(true);
    });

    it('detalhe por id segue a mesma regra, e cancelada some para quem não vê detalhes', async () => {
        expect(await ctx.useCases.getById({ id: 1, user: null })).not.toHaveProperty('title');
        expect(await ctx.useCases.getById({ id: 1, user: ADMIN_SALA })).toHaveProperty('title');
        ctx.bookingRepository.rows.get(1).status = 'canceled';
        await expect(ctx.useCases.getById({ id: 1, user: null })).rejects.toMatchObject({ statusCode: 404 });
        expect(await ctx.useCases.getById({ id: 1, user: ADMIN_SALA })).toMatchObject({ status: 'canceled' });
    });

    it('intervalo maior que 62 dias é 400', async () => {
        await expect(ctx.useCases.list({ query: { start: '2026-10-01', end: '2026-12-31' }, user: null }))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('criação', () => {
    it('comum nasce pendente; admin do espaço e dono, aprovada', async () => {
        const ctx = setup();
        const common = await ctx.useCases.create({ input: VALID, user: COMMON });
        expect(common).toMatchObject({ status: 'pending', created_by: 300, can_view_details: true, can_manage: true, can_review: false });

        const admin = await ctx.useCases.create({ input: { ...VALID, start_time: '16:00', end_time: '17:00' }, user: ADMIN_AUDITORIO });
        expect(admin).toMatchObject({ status: 'approved', reviewed_by: 476 });

        const owner = await ctx.useCases.create({ input: { ...VALID, space_id: SALA }, user: OWNER });
        expect(owner.status).toBe('approved');
    });

    it('admin de OUTRO espaço não reserva direto', async () => {
        const ctx = setup();
        const result = await ctx.useCases.create({ input: VALID, user: ADMIN_SALA });
        expect(result.status).toBe('pending');
    });

    it('conflito com pendente ou aprovada é 409 com o intervalo, checado dentro da trava', async () => {
        const ctx = setup();
        ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: '2026-10-09', start_time: '14:30', end_time: '15:30', status: 'pending' });
        const error = await ctx.useCases.create({ input: VALID, user: OWNER }).catch((e) => e);
        expect(error).toMatchObject({ statusCode: 409, code: 'REPP_BOOKING_CONFLICT' });
        expect(error.fields).toEqual({
            conflict: { start_time: '14:30', end_time: '15:30' },
            reason: 'overlap',
            setup_minutes: 0,
            blocked: { start_time: '14:30', end_time: '15:30' },
        });
        expect(ctx.bookingRepository.lockedCalls).toEqual([[AUDITORIO]]);
    });

    it('recusada e cancelada não bloqueiam; encostar não bloqueia', async () => {
        const ctx = setup();
        ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: '2026-10-09', start_time: '14:00', end_time: '15:00', status: 'canceled' });
        ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: '2026-10-09', start_time: '14:00', end_time: '15:00', status: 'rejected' });
        ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: '2026-10-09', start_time: '15:00', end_time: '16:00' });
        await expect(ctx.useCases.create({ input: VALID, user: COMMON })).resolves.toMatchObject({ status: 'pending' });
    });

    it('valida passado, ordem, espaço e Protheus', async () => {
        const ctx = setup();
        await expect(ctx.useCases.create({ input: { ...VALID, booking_date: '2026-10-08', start_time: '09:00', end_time: '11:00' }, user: COMMON }))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(ctx.useCases.create({ input: { ...VALID, end_time: '13:00' }, user: COMMON }))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(ctx.useCases.create({ input: { ...VALID, space_id: 99 }, user: COMMON }))
            .rejects.toMatchObject({ statusCode: 404 });
        await expect(ctx.useCases.create({ input: { ...VALID, space_id: 3 }, user: COMMON }))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(ctx.useCases.create({ input: { ...VALID, cost_center_code: '9999' }, user: COMMON }))
            .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Centro de custo/) });
    });

    it('solicitante e organização ausentes vêm da sessão; descrições vêm do Protheus', async () => {
        const ctx = setup();
        const { company_code, branch_code, cost_center_code, ...input } = VALID;
        const result = await ctx.useCases.create({ input: { ...input, company_name: 'FORJADO' }, user: COMMON });
        expect(result).toMatchObject({ requester_name: 'COMUM', company_code: '02', company_name: 'PEG PESE', cost_center_description: 'RH' });
    });

    it('organização vazia ou nula no corpo também vem da sessão', async () => {
        const ctx = setup();
        const result = await ctx.useCases.create({
            input: { ...VALID, company_code: '', branch_code: '  ', cost_center_code: null },
            user: COMMON,
        });
        expect(result).toMatchObject({ company_code: '02', branch_code: '0201', cost_center_code: '1001' });
    });

    it('sem organização no corpo nem na sessão responde REPP_ORGANIZATION_UNKNOWN', async () => {
        const ctx = setup();
        const { company_code, branch_code, cost_center_code, ...input } = VALID;
        const noLink = { ...COMMON, company_code: null, cost_center_code: null };
        await expect(ctx.useCases.create({ input, user: noLink }))
            .rejects.toMatchObject({ statusCode: 400, code: 'REPP_ORGANIZATION_UNKNOWN' });
        // Informando no corpo, quem não tem vínculo reserva normalmente.
        await expect(ctx.useCases.create({ input: VALID, user: noLink })).resolves.toMatchObject({ company_code: '02' });
    });
});

describe('edição, cancelamento e aprovação', () => {
    let ctx;
    let id;
    beforeEach(async () => {
        ctx = setup();
        ({ id } = await ctx.useCases.create({ input: VALID, user: COMMON }));
        await ctx.useCases.approve({ id, user: ADMIN_AUDITORIO });
    });

    it('criador que troca o horário de aprovada volta para pendente e solta o horário antigo', async () => {
        const result = await ctx.useCases.update({ id, input: { start_time: '16:00', end_time: '17:00' }, user: COMMON });
        expect(result).toMatchObject({ status: 'pending', start_time: '16:00', reviewed_by: null });
        const other = await ctx.useCases.create({ input: VALID, user: OWNER });
        expect(other.status).toBe('approved');
    });

    it('criador que troca só o título mantém aprovada', async () => {
        const result = await ctx.useCases.update({ id, input: { title: 'Novo título' }, user: COMMON });
        expect(result).toMatchObject({ status: 'approved', title: 'Novo título', updated_by: 300 });
    });

    it('organização vazia na edição mantém a da reserva', async () => {
        const result = await ctx.useCases.update({ id, input: { title: 'Outro', company_code: '', cost_center_code: '' }, user: COMMON });
        expect(result).toMatchObject({ title: 'Outro', company_code: '02', cost_center_code: '1001' });
        expect(ctx.organizationDirectory.resolve).toHaveBeenCalledTimes(1);
    });

    it('admin do espaço troca horário sem perder a aprovação', async () => {
        const result = await ctx.useCases.update({ id, input: { start_time: '16:00', end_time: '17:00' }, user: ADMIN_AUDITORIO });
        expect(result.status).toBe('approved');
    });

    it('edição para horário ocupado é 409', async () => {
        ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: '2026-10-09', start_time: '16:00', end_time: '17:00' });
        await expect(ctx.useCases.update({ id, input: { start_time: '16:30', end_time: '17:30' }, user: COMMON }))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('cancelamento sem permissão é 403; criador e admin cancelam', async () => {
        await expect(ctx.useCases.cancel({ id, user: OTHER })).rejects.toMatchObject({ statusCode: 403 });
        await expect(ctx.useCases.cancel({ id, user: ADMIN_SALA })).rejects.toMatchObject({ statusCode: 403 });
        const result = await ctx.useCases.cancel({ id, reason: ' mudou a data ', user: COMMON });
        expect(result).toMatchObject({ status: 'canceled', canceled_by: 300, cancel_reason: 'mudou a data', can_manage: false });
    });

    it('reserva que já começou não se altera nem cancela', async () => {
        const started = ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: '2026-10-08', start_time: '09:00', end_time: '11:00', created_by: 300 });
        await expect(ctx.useCases.cancel({ id: started, user: COMMON })).rejects.toMatchObject({ statusCode: 400 });
        await expect(ctx.useCases.update({ id: started, input: { title: 'x' }, user: OWNER })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('só o admin do espaço (ou dono) aprova e recusa; criador não', async () => {
        const { id: pending } = await ctx.useCases.create({ input: { ...VALID, start_time: '18:00', end_time: '19:00' }, user: COMMON });
        await expect(ctx.useCases.approve({ id: pending, user: COMMON })).rejects.toMatchObject({ statusCode: 403 });
        await expect(ctx.useCases.approve({ id: pending, user: ADMIN_SALA })).rejects.toMatchObject({ statusCode: 403 });
        const rejected = await ctx.useCases.reject({ id: pending, reason: 'Evento da diretoria', user: OWNER });
        expect(rejected).toMatchObject({ status: 'rejected', review_note: 'Evento da diretoria' });
        await expect(ctx.useCases.approve({ id: pending, user: OWNER })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('fila de aprovação só para quem administra, e só dos seus espaços', async () => {
        await ctx.useCases.create({ input: { ...VALID, start_time: '18:00', end_time: '19:00' }, user: COMMON });
        await ctx.useCases.create({ input: { ...VALID, space_id: SALA }, user: COMMON });
        await expect(ctx.useCases.listPending({ user: COMMON })).rejects.toMatchObject({ statusCode: 403 });
        const auditorio = await ctx.useCases.listPending({ user: ADMIN_AUDITORIO });
        expect(auditorio.map((b) => b.space_id)).toEqual([AUDITORIO]);
        expect(auditorio[0].can_review).toBe(true);
        expect(await ctx.useCases.listPending({ user: OWNER })).toHaveLength(2);
    });
});

describe('notificações', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('pedido de quem não administra avisa os admins do espaço (requested), com título e solicitante', async () => {
        const ctx = setup();
        const { id } = await ctx.useCases.create({ input: VALID, user: COMMON });
        await flush();
        expect(ctx.bookingRepository.notifications).toEqual([expect.objectContaining({
            user_id: ADMIN_AUDITORIO.id, booking_id: id, action: 'requested', by_user_id: COMMON.id,
            payload: expect.objectContaining({ space_name: 'Auditório', title: 'Reunião', requester_name: 'COMUM', by_name: 'COMUM', previous: null }),
        })]);
        expect(ctx.eventPublisher.publish).toHaveBeenCalledWith(ADMIN_AUDITORIO.id, expect.objectContaining({ id: 1, action: 'requested', booking_id: id }));
    });

    it('reserva aprovada na hora avisa os OUTROS admins do espaço (created); quem criou não se avisa', async () => {
        const ctx = setup();
        await ctx.useCases.create({ input: VALID, user: ADMIN_AUDITORIO });
        await flush();
        expect(ctx.bookingRepository.notifications).toEqual([]);

        const { id } = await ctx.useCases.create({ input: { ...VALID, space_id: SALA }, user: OWNER });
        await flush();
        expect(ctx.bookingRepository.notifications).toEqual([expect.objectContaining({
            user_id: ADMIN_SALA.id, booking_id: id, action: 'created', by_user_id: OWNER.id,
            payload: expect.objectContaining({ space_name: 'Sala de Treinamento', title: 'Reunião', by_name: 'DONO' }),
        })]);
        expect(ctx.eventPublisher.publish).toHaveBeenCalledWith(ADMIN_SALA.id, expect.objectContaining({ action: 'created', booking_id: id }));
    });

    it('reserva pendente gera só requested, nunca requested + created', async () => {
        const ctx = setup();
        ctx.spaceRepository.admins.push([AUDITORIO, 9]);
        await ctx.useCases.create({ input: VALID, user: COMMON });
        expect(ctx.bookingRepository.notifications.map((n) => [n.user_id, n.action]))
            .toEqual([[476, 'requested'], [9, 'requested']]);
    });

    it('aprovar, recusar e cancelar por outra pessoa avisam o criador, com o mesmo id no evento', async () => {
        const ctx = setup();
        const a = await ctx.useCases.create({ input: VALID, user: COMMON });
        const b = await ctx.useCases.create({ input: { ...VALID, start_time: '16:00', end_time: '17:00' }, user: COMMON });
        await flush();
        ctx.bookingRepository.notifications.length = 0;
        ctx.eventPublisher.publish.mockClear();

        await ctx.useCases.approve({ id: a.id, user: ADMIN_AUDITORIO });
        await ctx.useCases.reject({ id: b.id, reason: 'Evento da diretoria', user: OWNER });
        await ctx.useCases.cancel({ id: a.id, reason: 'Manutenção', user: ADMIN_AUDITORIO });
        await flush();

        const sent = ctx.bookingRepository.notifications.map((n) => [n.user_id, n.action, n.payload.reason]);
        expect(sent).toEqual([[COMMON.id, 'approved', null], [COMMON.id, 'rejected', 'Evento da diretoria'], [COMMON.id, 'canceled', 'Manutenção']]);
        const events = ctx.eventPublisher.publish.mock.calls.map(([userId, payload]) => [userId, payload.id, payload.action]);
        expect(events).toEqual(ctx.bookingRepository.notifications.map((n) => [n.user_id, n.id, n.action]));
    });

    it('o criador agindo na própria reserva não se avisa', async () => {
        const ctx = setup();
        const { id } = await ctx.useCases.create({ input: { ...VALID, space_id: SALA }, user: ADMIN_SALA });
        await ctx.useCases.update({ id, input: { title: 'Outro' }, user: ADMIN_SALA });
        await ctx.useCases.cancel({ id, user: ADMIN_SALA });
        expect(ctx.bookingRepository.notifications).toEqual([]);
    });

    it('admin alterando horário avisa o criador com previous; criador remarcando avisa os admins', async () => {
        const ctx = setup();
        const { id } = await ctx.useCases.create({ input: VALID, user: COMMON });
        await ctx.useCases.approve({ id, user: ADMIN_AUDITORIO });
        ctx.bookingRepository.notifications.length = 0;

        await ctx.useCases.update({ id, input: { start_time: '16:00', end_time: '17:00' }, user: ADMIN_AUDITORIO });
        expect(ctx.bookingRepository.notifications[0]).toMatchObject({
            user_id: COMMON.id, action: 'updated',
            payload: { start_time: '16:00', previous: { space_name: 'Auditório', booking_date: '2026-10-09', start_time: '14:00', end_time: '15:00' } },
        });

        ctx.bookingRepository.notifications.length = 0;
        await ctx.useCases.update({ id, input: { start_time: '18:00', end_time: '19:00' }, user: COMMON });
        expect(ctx.bookingRepository.notifications).toEqual([expect.objectContaining({
            user_id: ADMIN_AUDITORIO.id, action: 'requested',
            payload: expect.objectContaining({ start_time: '18:00', previous: expect.objectContaining({ start_time: '16:00' }) }),
        })]);
    });

    it('falha no WebSocket não falha a ação — o aviso já está gravado', async () => {
        const ctx = setup();
        ctx.eventPublisher.publish.mockRejectedValue(new Error('ws fora'));
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { id } = await ctx.useCases.create({ input: VALID, user: COMMON });
        await expect(ctx.useCases.approve({ id, user: ADMIN_AUDITORIO })).resolves.toMatchObject({ status: 'approved' });
        await flush();
        expect(ctx.bookingRepository.notifications.map((n) => n.action)).toEqual(['requested', 'approved']);
        spy.mockRestore();
    });

    it('ação que falha (conflito) não grava aviso', async () => {
        const ctx = setup();
        ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: '2026-10-09', start_time: '14:00', end_time: '15:00' });
        await expect(ctx.useCases.create({ input: VALID, user: COMMON })).rejects.toMatchObject({ statusCode: 409 });
        expect(ctx.bookingRepository.notifications).toEqual([]);
    });
});

describe('minhas reservas', () => {
    it('todas as do criador, em qualquer status, mais recentes primeiro, paginadas', async () => {
        const ctx = setup();
        const a = await ctx.useCases.create({ input: VALID, user: COMMON });
        const b = await ctx.useCases.create({ input: { ...VALID, booking_date: '2026-10-10' }, user: COMMON });
        await ctx.useCases.create({ input: { ...VALID, space_id: SALA }, user: OTHER });
        await ctx.useCases.reject({ id: a.id, user: OWNER });

        const page = await ctx.useCases.listMine({ query: {}, user: COMMON });
        expect(page.items.map((i) => [i.id, i.status])).toEqual([[b.id, 'pending'], [a.id, 'rejected']]);
        expect(page.items[1]).toMatchObject({ can_view_details: true, can_manage: false });
        expect(page.pagination).toEqual({ total: 2, limit: 50, offset: 0, page: 1, pages: 1 });

        const rejected = await ctx.useCases.listMine({ query: { status: 'rejected,canceled' }, user: COMMON });
        expect(rejected.items.map((i) => i.id)).toEqual([a.id]);
        await expect(ctx.useCases.listMine({ query: { status: 'apagada' }, user: COMMON }))
            .rejects.toMatchObject({ statusCode: 400, code: 'REPP_INVALID_STATUS' });
        await expect(ctx.useCases.listMine({ query: { start: '2026-10-10', end: '2026-10-01' }, user: COMMON }))
            .rejects.toMatchObject({ code: 'REPP_INVALID_DATE_RANGE' });
    });
});

describe('códigos de erro', () => {
    it('todo erro sai com code REPP_* específico, nunca GENERIC_ERROR', async () => {
        const ctx = setup();
        const { id } = await ctx.useCases.create({ input: VALID, user: COMMON });
        ctx.bookingRepository.seed({ space_id: SALA, booking_date: '2026-10-09', start_time: '09:00', end_time: '10:00' });
        const started = ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: '2026-10-08', start_time: '09:00', end_time: '11:00', created_by: 300, status: 'pending' });

        const cases = [
            ['REPP_INVALID_DATE', () => ctx.useCases.list({ query: {}, user: null })],
            ['REPP_INVALID_DATE_RANGE', () => ctx.useCases.list({ query: { start: '2026-10-10', end: '2026-10-01' }, user: null })],
            ['REPP_DATE_RANGE_TOO_LONG', () => ctx.useCases.list({ query: { start: '2026-10-01', end: '2026-12-31' }, user: null })],
            ['REPP_INVALID_SPACE_ID', () => ctx.useCases.list({ query: { ...RANGE, space_id: 'x' }, user: null })],
            ['REPP_INVALID_TIME', () => ctx.useCases.create({ input: { ...VALID, start_time: '25:00' }, user: COMMON })],
            ['REPP_INVALID_TIME_RANGE', () => ctx.useCases.create({ input: { ...VALID, end_time: '13:00' }, user: COMMON })],
            ['REPP_BOOKING_IN_PAST', () => ctx.useCases.create({ input: { ...VALID, booking_date: '2026-10-01' }, user: COMMON })],
            ['REPP_REQUIRED_FIELD', () => ctx.useCases.create({ input: { ...VALID, title: '   ' }, user: COMMON })],
            ['REPP_FIELD_TOO_LONG', () => ctx.useCases.create({ input: { ...VALID, title: 'x'.repeat(151) }, user: COMMON })],
            ['REPP_INVALID_ORGANIZATION_CODE', () => ctx.useCases.create({ input: { ...VALID, branch_code: '201' }, user: COMMON })],
            ['REPP_COMPANY_NOT_FOUND', () => ctx.useCases.create({ input: { ...VALID, company_code: '05' }, user: COMMON })],
            ['REPP_BRANCH_NOT_FOUND', () => ctx.useCases.create({ input: { ...VALID, branch_code: '0999' }, user: COMMON })],
            ['REPP_COST_CENTER_NOT_FOUND', () => ctx.useCases.create({ input: { ...VALID, cost_center_code: '9' }, user: COMMON })],
            ['REPP_SPACE_NOT_FOUND', () => ctx.useCases.create({ input: { ...VALID, space_id: 99 }, user: COMMON })],
            ['REPP_SPACE_INACTIVE', () => ctx.useCases.create({ input: { ...VALID, space_id: 3 }, user: COMMON })],
            ['REPP_BOOKING_CONFLICT', () => ctx.useCases.create({ input: VALID, user: OWNER })],
            ['REPP_BOOKING_NOT_FOUND', () => ctx.useCases.getById({ id: 999, user: null })],
            ['REPP_BOOKING_FORBIDDEN', () => ctx.useCases.cancel({ id, user: OTHER })],
            ['REPP_BOOKING_NOT_EDITABLE', () => ctx.useCases.cancel({ id: started, user: COMMON })],
            ['REPP_REVIEW_FORBIDDEN', () => ctx.useCases.approve({ id, user: ADMIN_SALA })],
            ['REPP_BOOKING_ALREADY_STARTED', () => ctx.useCases.approve({ id: started, user: OWNER })],
            ['REPP_NOT_SPACE_ADMIN', () => ctx.useCases.listPending({ user: COMMON })],
        ];

        for (const [code, run] of cases) {
            await expect(run()).rejects.toMatchObject({ code });
        }

        await ctx.useCases.approve({ id, user: OWNER });
        await expect(ctx.useCases.approve({ id, user: OWNER })).rejects.toMatchObject({ code: 'REPP_BOOKING_NOT_PENDING' });
    });
});

describe('espaços', () => {
    it('flags por espaço para quem consulta', async () => {
        const { spaces } = setup();
        const anon = await spaces.list(null);
        expect(anon.map((s) => s.name)).toEqual(['Sala de Treinamento', 'Auditório']);
        expect(anon[0]).toMatchObject({ can_view_details: false, can_book: false, requires_approval: false });

        const admin = await spaces.list(ADMIN_AUDITORIO);
        expect(admin.find((s) => s.id === AUDITORIO)).toMatchObject({ can_manage: true, requires_approval: false });
        expect(admin.find((s) => s.id === SALA)).toMatchObject({ can_manage: false, can_book: true, requires_approval: true });

        expect((await spaces.listManaged(ADMIN_AUDITORIO)).map((s) => s.id)).toEqual([AUDITORIO]);
        expect(await spaces.listManaged(COMMON)).toEqual([]);
        expect(await spaces.listManaged(OWNER)).toHaveLength(2);
    });
});

describe('regras de agenda (15/10/2026)', () => {
    // NOW = quinta 08/10/2026 10:00 → mínimo 09/10 10:00, máximo 08/12/2026.
    const TUESDAY = '2026-10-13';
    const FRIDAY = '2026-10-09';

    describe('dias da semana bloqueados (Auditório: terça e quinta)', () => {
        it('comum não reserva no dia bloqueado; outro espaço e quem administra, sim', async () => {
            const ctx = withAuditoriumRules(setup());
            const error = await ctx.useCases.create({ input: { ...VALID, booking_date: TUESDAY }, user: COMMON }).catch((e) => e);
            expect(error).toMatchObject({ statusCode: 400, code: 'REPP_BOOKING_WEEKDAY_BLOCKED', message: expect.stringMatching(/terças-feiras/) });
            expect(error.fields).toEqual({ booking_date: TUESDAY, weekday: 2, blocked_weekdays: [2, 4] });
            // Admin da Sala não administra o Auditório: vale a regra para ele.
            await expect(ctx.useCases.create({ input: { ...VALID, booking_date: TUESDAY }, user: ADMIN_SALA }))
                .rejects.toMatchObject({ code: 'REPP_BOOKING_WEEKDAY_BLOCKED' });

            await expect(ctx.useCases.create({ input: { ...VALID, space_id: SALA, booking_date: TUESDAY }, user: COMMON }))
                .resolves.toMatchObject({ status: 'pending' });
            await expect(ctx.useCases.create({ input: { ...VALID, booking_date: TUESDAY }, user: ADMIN_AUDITORIO }))
                .resolves.toMatchObject({ status: 'approved' });
            await expect(ctx.useCases.create({ input: { ...VALID, booking_date: '2026-10-15', start_time: '08:00', end_time: '09:00' }, user: OWNER }))
                .resolves.toMatchObject({ status: 'approved' });
        });

        it('data liberada pelo administrador aceita reserva comum; rebloquear volta a recusar', async () => {
            const ctx = withAuditoriumRules(setup());
            const space = await ctx.spaces.unblockDate({ id: AUDITORIO, date: TUESDAY, user: ADMIN_AUDITORIO });
            expect(space).toMatchObject({ id: AUDITORIO, unblocked_dates: [TUESDAY], booking_rules_exempt: true });
            // Idempotente.
            await ctx.spaces.unblockDate({ id: AUDITORIO, date: TUESDAY, user: ADMIN_AUDITORIO });

            await expect(ctx.useCases.create({ input: { ...VALID, booking_date: TUESDAY }, user: COMMON }))
                .resolves.toMatchObject({ status: 'pending' });

            const reblocked = await ctx.spaces.reblockDate({ id: AUDITORIO, date: TUESDAY, user: OWNER });
            expect(reblocked.unblocked_dates).toEqual([]);
            await expect(ctx.useCases.create({ input: { ...VALID, booking_date: TUESDAY, start_time: '18:00', end_time: '19:00' }, user: COMMON }))
                .rejects.toMatchObject({ code: 'REPP_BOOKING_WEEKDAY_BLOCKED' });
        });

        it('liberar data: só quem administra, só dia bloqueado, só hoje em diante', async () => {
            const ctx = withAuditoriumRules(setup());
            await expect(ctx.spaces.unblockDate({ id: AUDITORIO, date: TUESDAY, user: COMMON }))
                .rejects.toMatchObject({ statusCode: 403, code: 'REPP_NOT_SPACE_ADMIN' });
            await expect(ctx.spaces.unblockDate({ id: AUDITORIO, date: TUESDAY, user: ADMIN_SALA }))
                .rejects.toMatchObject({ statusCode: 403 });
            await expect(ctx.spaces.unblockDate({ id: AUDITORIO, date: FRIDAY, user: ADMIN_AUDITORIO }))
                .rejects.toMatchObject({ statusCode: 400, code: 'REPP_DATE_NOT_BLOCKED', fields: { date: FRIDAY, weekday: 5, blocked_weekdays: [2, 4] } });
            await expect(ctx.spaces.unblockDate({ id: AUDITORIO, date: '2026-10-06', user: ADMIN_AUDITORIO }))
                .rejects.toMatchObject({ statusCode: 400, code: 'REPP_BOOKING_IN_PAST' });
            await expect(ctx.spaces.unblockDate({ id: AUDITORIO, date: '2026-02-30', user: ADMIN_AUDITORIO }))
                .rejects.toMatchObject({ code: 'REPP_INVALID_DATE' });
            await expect(ctx.spaces.unblockDate({ id: 99, date: TUESDAY, user: OWNER }))
                .rejects.toMatchObject({ statusCode: 404, code: 'REPP_SPACE_NOT_FOUND' });
            // Hoje (quinta) ainda pode ser liberado.
            await expect(ctx.spaces.unblockDate({ id: AUDITORIO, date: '2026-10-08', user: ADMIN_AUDITORIO }))
                .resolves.toMatchObject({ unblocked_dates: ['2026-10-08'] });
        });
    });

    describe('antecedência', () => {
        it('comum: início com pelo menos 24h; exatamente 24h passa', async () => {
            const ctx = setup();
            const error = await ctx.useCases.create({ input: { ...VALID, start_time: '09:59', end_time: '11:00' }, user: COMMON }).catch((e) => e);
            expect(error).toMatchObject({ statusCode: 400, code: 'REPP_BOOKING_TOO_SOON', message: expect.stringMatching(/09\/10\/2026 às 10:00/) });
            expect(error.fields).toEqual({ min_booking_at: '2026-10-09T10:00' });
            await expect(ctx.useCases.create({ input: { ...VALID, start_time: '10:00', end_time: '11:00' }, user: COMMON }))
                .resolves.toMatchObject({ status: 'pending' });
        });

        it('comum: até a mesma data daqui a 2 meses', async () => {
            const ctx = setup();
            const error = await ctx.useCases.create({ input: { ...VALID, booking_date: '2026-12-09' }, user: COMMON }).catch((e) => e);
            expect(error).toMatchObject({ statusCode: 400, code: 'REPP_BOOKING_TOO_FAR', message: expect.stringMatching(/08\/12\/2026/) });
            expect(error.fields).toEqual({ max_booking_date: '2026-12-08' });
            await expect(ctx.useCases.create({ input: { ...VALID, booking_date: '2026-12-08' }, user: COMMON }))
                .resolves.toMatchObject({ status: 'pending' });
        });

        it('administrador do espaço e dono ignoram 24h e 2 meses', async () => {
            const ctx = setup();
            await expect(ctx.useCases.create({ input: { ...VALID, booking_date: '2026-10-08', start_time: '11:00', end_time: '12:00' }, user: ADMIN_AUDITORIO }))
                .resolves.toMatchObject({ status: 'approved' });
            await expect(ctx.useCases.create({ input: { ...VALID, space_id: SALA, booking_date: '2027-03-01' }, user: OWNER }))
                .resolves.toMatchObject({ status: 'approved' });
            // O passado continua proibido para todos.
            await expect(ctx.useCases.create({ input: { ...VALID, booking_date: '2026-10-08', start_time: '09:00', end_time: '12:00' }, user: OWNER }))
                .rejects.toMatchObject({ code: 'REPP_BOOKING_IN_PAST' });
        });
    });

    describe('folga de organização (Auditório: 60 min)', () => {
        const at = (start_time, end_time, extra = {}) => ({ ...VALID, start_time, end_time, ...extra });

        it('recusa quem invade a folga, com reason=setup e o intervalo bloqueado; 1h exata passa', async () => {
            const ctx = withAuditoriumRules(setup());
            ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: FRIDAY, start_time: '14:00', end_time: '15:00' });

            const after = await ctx.useCases.create({ input: at('15:30', '16:30'), user: COMMON }).catch((e) => e);
            expect(after).toMatchObject({ statusCode: 409, code: 'REPP_BOOKING_CONFLICT', message: expect.stringMatching(/intervalo de 1 hora entre reservas.*das 13:00 às 16:00/) });
            expect(after.fields).toEqual({
                conflict: { start_time: '14:00', end_time: '15:00' },
                reason: 'setup',
                setup_minutes: 60,
                blocked: { start_time: '13:00', end_time: '16:00' },
            });
            await expect(ctx.useCases.create({ input: at('12:30', '13:30'), user: COMMON }))
                .rejects.toMatchObject({ fields: { reason: 'setup' } });

            await expect(ctx.useCases.create({ input: at('16:00', '17:00'), user: COMMON })).resolves.toMatchObject({ status: 'pending' });
            await expect(ctx.useCases.create({ input: at('12:00', '13:00'), user: COMMON })).resolves.toMatchObject({ status: 'pending' });
        });

        it('vale também para quem administra; espaço sem folga aceita encostar', async () => {
            const ctx = withAuditoriumRules(setup());
            ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: FRIDAY, start_time: '14:00', end_time: '15:00' });
            ctx.bookingRepository.seed({ space_id: SALA, booking_date: FRIDAY, start_time: '14:00', end_time: '15:00' });
            await expect(ctx.useCases.create({ input: at('15:00', '16:00'), user: OWNER }))
                .rejects.toMatchObject({ fields: { reason: 'setup' } });
            await expect(ctx.useCases.create({ input: at('15:00', '16:00', { space_id: SALA }), user: COMMON }))
                .resolves.toMatchObject({ status: 'pending' });
        });

        it('sobreposição de verdade tem prioridade sobre a folga na mensagem', async () => {
            const ctx = withAuditoriumRules(setup());
            ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: FRIDAY, start_time: '10:00', end_time: '11:00' });
            ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: FRIDAY, start_time: '12:00', end_time: '13:00' });
            const error = await ctx.useCases.create({ input: at('11:30', '12:30'), user: OWNER }).catch((e) => e);
            expect(error.fields).toMatchObject({ reason: 'overlap', conflict: { start_time: '12:00', end_time: '13:00' }, blocked: { start_time: '11:00', end_time: '14:00' } });
            expect(error.message).toMatch(/conflita com uma reserva existente das 12:00 às 13:00/);
        });

        it('a janela consultada é a reserva ± folga, presa ao dia', async () => {
            const ctx = withAuditoriumRules(setup());
            await ctx.useCases.create({ input: at('23:00', '23:30'), user: OWNER });
            await ctx.useCases.create({ input: at('00:15', '01:00', { booking_date: '2026-10-10' }), user: OWNER });
            expect(ctx.bookingRepository.conflictProbes.map((p) => [p.start_time, p.end_time]))
                .toEqual([['22:00', '23:59'], ['00:00', '02:00']]);
        });

        it('aprovação não reaplica a folga (pedido anterior à regra continua aprovável)', async () => {
            const ctx = withAuditoriumRules(setup());
            ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: FRIDAY, start_time: '14:00', end_time: '15:00' });
            const legacy = ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: FRIDAY, start_time: '15:00', end_time: '16:00', status: 'pending', created_by: 300 });
            await expect(ctx.useCases.approve({ id: legacy, user: ADMIN_AUDITORIO })).resolves.toMatchObject({ status: 'approved' });
        });
    });

    describe('edição (PUT) só reaplica o que mudou', () => {
        // Sexta 09/10 08:00: a reserva das 14:00 de hoje está a menos de 24h.
        const LATER = new Date(2026, 9, 9, 8, 0, 0);

        it('título ou só o fim não esbarram nas 24h; mudar o início sim', async () => {
            const ctx = withAuditoriumRules(setup(LATER));
            const id = ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: FRIDAY, start_time: '14:00', end_time: '15:00', created_by: 300 });
            await expect(ctx.useCases.update({ id, input: { title: 'Outro' }, user: COMMON })).resolves.toMatchObject({ title: 'Outro' });
            await expect(ctx.useCases.update({ id, input: { end_time: '16:00' }, user: COMMON })).resolves.toMatchObject({ end_time: '16:00' });
            await expect(ctx.useCases.update({ id, input: { start_time: '13:00' }, user: COMMON }))
                .rejects.toMatchObject({ code: 'REPP_BOOKING_TOO_SOON', fields: { min_booking_at: '2026-10-10T08:00' } });
            // Quem administra muda o início mesmo assim.
            await expect(ctx.useCases.update({ id, input: { start_time: '13:00' }, user: ADMIN_AUDITORIO }))
                .resolves.toMatchObject({ start_time: '13:00' });
        });

        it('reserva já num dia bloqueado pode mudar de horário; mudar PARA dia bloqueado não', async () => {
            const ctx = withAuditoriumRules(setup(LATER));
            const onTuesday = ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: TUESDAY, start_time: '14:00', end_time: '15:00', created_by: 300 });
            await expect(ctx.useCases.update({ id: onTuesday, input: { start_time: '16:00', end_time: '17:00' }, user: COMMON }))
                .resolves.toMatchObject({ status: 'pending', start_time: '16:00' });

            const onMonday = ctx.bookingRepository.seed({ space_id: AUDITORIO, booking_date: '2026-10-12', start_time: '14:00', end_time: '15:00', created_by: 300 });
            await expect(ctx.useCases.update({ id: onMonday, input: { booking_date: '2026-10-15' }, user: COMMON }))
                .rejects.toMatchObject({ code: 'REPP_BOOKING_WEEKDAY_BLOCKED' });
            await expect(ctx.useCases.update({ id: onMonday, input: { booking_date: '2026-12-10' }, user: COMMON }))
                .rejects.toMatchObject({ code: 'REPP_BOOKING_TOO_FAR', fields: { max_booking_date: '2026-12-09' } });
        });
    });

    describe('GET /spaces', () => {
        it('limites calculados para quem consulta', async () => {
            const ctx = withAuditoriumRules(setup());
            ctx.spaceRepository.unblocked.add(`${AUDITORIO}|2026-10-06`); // passada: não sai
            ctx.spaceRepository.unblocked.add(`${AUDITORIO}|2026-10-20`);

            const common = await ctx.spaces.list(COMMON);
            expect(common.find((s) => s.id === AUDITORIO)).toMatchObject({
                blocked_weekdays: [2, 4], unblocked_dates: ['2026-10-20'], setup_minutes: 60,
                min_booking_at: '2026-10-09T10:00', max_booking_date: '2026-12-08', booking_rules_exempt: false,
            });
            expect(common.find((s) => s.id === SALA)).toMatchObject({
                blocked_weekdays: [], unblocked_dates: [], setup_minutes: 0,
                min_booking_at: '2026-10-09T10:00', max_booking_date: '2026-12-08', booking_rules_exempt: false,
            });

            const admin = await ctx.spaces.list(ADMIN_AUDITORIO);
            expect(admin.find((s) => s.id === AUDITORIO)).toMatchObject({
                blocked_weekdays: [2, 4], min_booking_at: null, max_booking_date: null, booking_rules_exempt: true,
            });
            expect(admin.find((s) => s.id === SALA)).toMatchObject({ booking_rules_exempt: false });
            expect((await ctx.spaces.listManaged(OWNER)).every((s) => s.booking_rules_exempt)).toBe(true);
        });
    });
});

describe('administradores do espaço (16/10/2026)', () => {
    it('can_manage_admins só para o dono', async () => {
        const ctx = setup();
        expect((await ctx.spaces.list(OWNER)).every((s) => s.can_manage_admins)).toBe(true);
        expect((await ctx.spaces.list(ADMIN_AUDITORIO)).some((s) => s.can_manage_admins)).toBe(false);
        expect((await ctx.spaces.list(null)).some((s) => s.can_manage_admins)).toBe(false);
    });

    it('lista: dono e admin do próprio espaço; os demais 403', async () => {
        const ctx = setup();
        await expect(ctx.spaces.listAdmins({ id: AUDITORIO, user: OWNER }))
            .resolves.toMatchObject({ space_id: AUDITORIO, can_manage_admins: true, items: [expect.objectContaining({ user_id: 476 })] });
        await expect(ctx.spaces.listAdmins({ id: AUDITORIO, user: ADMIN_AUDITORIO }))
            .resolves.toMatchObject({ can_manage_admins: false });
        await expect(ctx.spaces.listAdmins({ id: AUDITORIO, user: ADMIN_SALA }))
            .rejects.toMatchObject({ statusCode: 403, code: 'REPP_NOT_SPACE_ADMIN' });
        await expect(ctx.spaces.listAdmins({ id: AUDITORIO, user: COMMON }))
            .rejects.toMatchObject({ statusCode: 403 });
        await expect(ctx.spaces.listAdmins({ id: 99, user: OWNER }))
            .rejects.toMatchObject({ statusCode: 404, code: 'REPP_SPACE_NOT_FOUND' });
    });

    it('dono adiciona (idempotente); o novo admin passa a administrar e a receber requested', async () => {
        const ctx = setup();
        const first = await ctx.spaces.addAdmin({ id: AUDITORIO, userId: 301, user: OWNER });
        const again = await ctx.spaces.addAdmin({ id: AUDITORIO, userId: 301, user: OWNER });
        expect(first.items.map((a) => a.user_id)).toEqual([476, 301]);
        expect(again.items).toEqual(first.items);

        expect((await ctx.spaces.list(OTHER)).find((s) => s.id === AUDITORIO)).toMatchObject({ can_manage: true, booking_rules_exempt: true });
        await ctx.useCases.create({ input: VALID, user: COMMON });
        expect(ctx.bookingRepository.notifications.map((n) => [n.user_id, n.action])).toEqual([[476, 'requested'], [301, 'requested']]);
    });

    it('adicionar: só o dono; usuário precisa existir e estar ativo', async () => {
        const ctx = setup();
        await expect(ctx.spaces.addAdmin({ id: AUDITORIO, userId: 301, user: ADMIN_AUDITORIO }))
            .rejects.toMatchObject({ statusCode: 403, code: 'REPP_MANAGE_ADMINS_FORBIDDEN' });
        await expect(ctx.spaces.addAdmin({ id: AUDITORIO, userId: 999, user: OWNER }))
            .rejects.toMatchObject({ statusCode: 404, code: 'REPP_USER_NOT_FOUND' });
        await expect(ctx.spaces.addAdmin({ id: AUDITORIO, userId: 'x', user: OWNER }))
            .rejects.toMatchObject({ statusCode: 404, code: 'REPP_USER_NOT_FOUND' });
        await expect(ctx.spaces.addAdmin({ id: AUDITORIO, userId: 302, user: OWNER }))
            .rejects.toMatchObject({ statusCode: 400, code: 'REPP_USER_INACTIVE' });
    });

    it('remover: só o dono, idempotente, nunca o último administrador ativo', async () => {
        const ctx = setup();
        await expect(ctx.spaces.removeAdmin({ id: AUDITORIO, userId: 476, user: OWNER }))
            .rejects.toMatchObject({ statusCode: 409, code: 'REPP_LAST_SPACE_ADMIN' });
        await expect(ctx.spaces.removeAdmin({ id: AUDITORIO, userId: 476, user: ADMIN_AUDITORIO }))
            .rejects.toMatchObject({ statusCode: 403, code: 'REPP_MANAGE_ADMINS_FORBIDDEN' });

        // Outro admin, mas bloqueado, não conta como "sobra".
        ctx.spaceRepository.admins.push([AUDITORIO, 302]);
        await expect(ctx.spaces.removeAdmin({ id: AUDITORIO, userId: 476, user: OWNER }))
            .rejects.toMatchObject({ code: 'REPP_LAST_SPACE_ADMIN' });
        // O bloqueado pode sair: sobra o ativo.
        await expect(ctx.spaces.removeAdmin({ id: AUDITORIO, userId: 302, user: OWNER }))
            .resolves.toMatchObject({ items: [expect.objectContaining({ user_id: 476 })] });

        await ctx.spaces.addAdmin({ id: AUDITORIO, userId: 301, user: OWNER });
        const removed = await ctx.spaces.removeAdmin({ id: AUDITORIO, userId: 476, user: OWNER });
        expect(removed.items.map((a) => a.user_id)).toEqual([301]);
        // Idempotente: quem já não é admin.
        await expect(ctx.spaces.removeAdmin({ id: AUDITORIO, userId: 476, user: OWNER })).resolves.toMatchObject({ space_id: AUDITORIO });
        // A ex-admin perde o espaço.
        expect((await ctx.spaces.list(ADMIN_AUDITORIO)).find((s) => s.id === AUDITORIO)).toMatchObject({ can_manage: false });
    });
});

describe('cadastro de espaços (19/10/2026)', () => {
    const NEW = { name: 'Sala de Reunião 2', description: 'Térreo', blocked_weekdays: [4, 2, 2], setup_minutes: 30, admin_user_ids: [301, 301] };

    it('dono cria com administradores; o espaço sai no GET /spaces e o admin já administra', async () => {
        const ctx = setup();
        const created = await ctx.spaces.create({ input: NEW, user: OWNER });
        expect(created).toMatchObject({
            name: 'Sala de Reunião 2', description: 'Térreo', active: true,
            blocked_weekdays: [2, 4], setup_minutes: 30, can_edit_space: true, can_edit_agenda: true,
        });
        expect(ctx.spaceRepository.admins.filter(([s]) => s === created.id)).toEqual([[created.id, 301]]);

        expect((await ctx.spaces.list(null)).map((s) => s.id)).toContain(created.id);
        expect((await ctx.spaces.list(OTHER)).find((s) => s.id === created.id))
            .toMatchObject({ can_manage: true, can_edit_agenda: true, can_edit_space: false, booking_rules_exempt: true });
    });

    it('padrões: sem descrição, sem dias bloqueados e sem folga', async () => {
        const ctx = setup();
        const created = await ctx.spaces.create({ input: { name: 'Copa', admin_user_ids: [9] }, user: OWNER });
        expect(created).toMatchObject({ description: null, blocked_weekdays: [], setup_minutes: 0 });
    });

    it('criar: só o dono, com pelo menos um admin ativo e nome livre', async () => {
        const ctx = setup();
        const cases = [
            [ADMIN_AUDITORIO, NEW, 403, 'REPP_MANAGE_SPACES_FORBIDDEN'],
            [COMMON, NEW, 403, 'REPP_MANAGE_SPACES_FORBIDDEN'],
            [OWNER, { ...NEW, admin_user_ids: [] }, 400, 'REPP_SPACE_ADMIN_REQUIRED'],
            [OWNER, { ...NEW, admin_user_ids: undefined }, 400, 'REPP_SPACE_ADMIN_REQUIRED'],
            [OWNER, { ...NEW, admin_user_ids: ['x'] }, 404, 'REPP_USER_NOT_FOUND'],
            [OWNER, { ...NEW, admin_user_ids: [999] }, 404, 'REPP_USER_NOT_FOUND'],
            [OWNER, { ...NEW, admin_user_ids: [9, 302] }, 400, 'REPP_USER_INACTIVE'],
            [OWNER, { ...NEW, name: '  ' }, 400, 'REPP_REQUIRED_FIELD'],
            [OWNER, { ...NEW, name: 'x'.repeat(101) }, 400, 'REPP_FIELD_TOO_LONG'],
            [OWNER, { ...NEW, blocked_weekdays: [0] }, 400, 'REPP_INVALID_WEEKDAYS'],
            [OWNER, { ...NEW, blocked_weekdays: '2,4' }, 400, 'REPP_INVALID_WEEKDAYS'],
            [OWNER, { ...NEW, setup_minutes: 241 }, 400, 'REPP_INVALID_SETUP_MINUTES'],
            [OWNER, { ...NEW, setup_minutes: 1.5 }, 400, 'REPP_INVALID_SETUP_MINUTES'],
            [OWNER, { ...NEW, name: 'auditório' }, 409, 'REPP_SPACE_NAME_TAKEN'],
        ];
        for (const [user, input, statusCode, code] of cases) {
            await expect(ctx.spaces.create({ input, user })).rejects.toMatchObject({ statusCode, code });
        }
        expect(ctx.spaceRepository.spaces.size).toBe(3);
    });

    it('admin do espaço muda dias bloqueados e folga; o resto é do dono', async () => {
        const ctx = setup();
        const updated = await ctx.spaces.update({ id: AUDITORIO, input: { blocked_weekdays: ['2', 4], setup_minutes: 60 }, user: ADMIN_AUDITORIO });
        expect(updated).toMatchObject({ blocked_weekdays: [2, 4], setup_minutes: 60 });

        // O formulário inteiro com o nome igual não é "mudar o nome".
        await expect(ctx.spaces.update({ id: AUDITORIO, input: { name: 'Auditório', description: null, blocked_weekdays: [2] }, user: ADMIN_AUDITORIO }))
            .resolves.toMatchObject({ blocked_weekdays: [2] });

        await expect(ctx.spaces.update({ id: AUDITORIO, input: { name: 'Auditório Novo' }, user: ADMIN_AUDITORIO }))
            .rejects.toMatchObject({ statusCode: 403, code: 'REPP_MANAGE_SPACES_FORBIDDEN', fields: { forbidden: ['name'] } });
        await expect(ctx.spaces.update({ id: AUDITORIO, input: { active: false }, user: ADMIN_AUDITORIO }))
            .rejects.toMatchObject({ statusCode: 403, code: 'REPP_MANAGE_SPACES_FORBIDDEN' });
        await expect(ctx.spaces.update({ id: AUDITORIO, input: { setup_minutes: 10 }, user: ADMIN_SALA }))
            .rejects.toMatchObject({ statusCode: 403, code: 'REPP_NOT_SPACE_ADMIN' });
        await expect(ctx.spaces.update({ id: AUDITORIO, input: { setup_minutes: 10 }, user: COMMON }))
            .rejects.toMatchObject({ statusCode: 403, code: 'REPP_NOT_SPACE_ADMIN' });
        await expect(ctx.spaces.update({ id: 99, input: {}, user: OWNER }))
            .rejects.toMatchObject({ statusCode: 404, code: 'REPP_SPACE_NOT_FOUND' });
        await expect(ctx.spaces.update({ id: AUDITORIO, input: { name: 'Sala de Treinamento' }, user: OWNER }))
            .rejects.toMatchObject({ statusCode: 409, code: 'REPP_SPACE_NAME_TAKEN' });
        await expect(ctx.spaces.update({ id: AUDITORIO, input: { active: 'sim' }, user: OWNER }))
            .rejects.toMatchObject({ statusCode: 400, code: 'REPP_INVALID_ACTIVE' });
    });

    it('bloquear a terça pela API vale na hora para a reserva comum', async () => {
        const ctx = setup();
        await ctx.spaces.update({ id: AUDITORIO, input: { blocked_weekdays: [2, 4] }, user: ADMIN_AUDITORIO });
        // 13/10/2026 é terça.
        await expect(ctx.useCases.create({ input: { ...VALID, booking_date: '2026-10-13' }, user: COMMON }))
            .rejects.toMatchObject({ code: 'REPP_BOOKING_WEEKDAY_BLOCKED' });
        await ctx.spaces.unblockDate({ id: AUDITORIO, date: '2026-10-13', user: ADMIN_AUDITORIO });
        await expect(ctx.useCases.create({ input: { ...VALID, booking_date: '2026-10-13' }, user: COMMON }))
            .resolves.toMatchObject({ status: 'pending' });

        // Tirar o bloqueio da terça esconde a data liberada (não tem mais efeito).
        const after = await ctx.spaces.update({ id: AUDITORIO, input: { blocked_weekdays: [4] }, user: ADMIN_AUDITORIO });
        expect(after.unblocked_dates).toEqual([]);
    });

    it('dono desativa e reativa; inativo some do GET /spaces e não aceita reserva', async () => {
        const ctx = setup();
        const off = await ctx.spaces.update({ id: SALA, input: { active: false }, user: OWNER });
        expect(off).toMatchObject({ active: false, can_book: false, requires_approval: false });
        expect((await ctx.spaces.list(null)).map((s) => s.id)).not.toContain(SALA);
        expect((await ctx.spaces.listManaged(OWNER)).map((s) => s.id)).not.toContain(SALA);
        expect((await ctx.spaces.listManaged(OWNER, { includeInactive: true })).map((s) => s.id)).toEqual(expect.arrayContaining([SALA, 3]));
        expect((await ctx.spaces.listManaged(ADMIN_SALA, { includeInactive: true })).map((s) => s.id)).toEqual([SALA]);
        await expect(ctx.useCases.create({ input: { ...VALID, space_id: SALA }, user: COMMON }))
            .rejects.toMatchObject({ code: 'REPP_SPACE_INACTIVE' });

        const on = await ctx.spaces.update({ id: SALA, input: { active: true }, user: OWNER });
        expect(on).toMatchObject({ active: true, can_book: true });
    });

    it('sem mudança, nada é gravado', async () => {
        const ctx = setup();
        const spy = jest.spyOn(ctx.spaceRepository, 'updateSpace');
        await ctx.spaces.update({ id: SALA, input: { name: 'Sala de Treinamento', blocked_weekdays: [], setup_minutes: 0 }, user: ADMIN_SALA });
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('lembrete (19/10/2026)', () => {
    it('quem cria escolhe a antecedência; ausente ou nulo = sem lembrete', async () => {
        const ctx = setup();
        const with30 = await ctx.useCases.create({ input: { ...VALID, reminder_minutes: 30 }, user: COMMON });
        expect(with30).toMatchObject({ reminder_minutes: 30, reminder_sent_at: null });

        const none = await ctx.useCases.create({ input: { ...VALID, space_id: SALA }, user: COMMON });
        expect(none.reminder_minutes).toBeNull();

        const explicitNull = await ctx.useCases.create({ input: { ...VALID, start_time: '16:00', end_time: '17:00', reminder_minutes: null }, user: COMMON });
        expect(explicitNull.reminder_minutes).toBeNull();
    });

    it('valor fora da lista é 400 REPP_INVALID_REMINDER, antes de gravar', async () => {
        const ctx = setup();
        for (const reminder_minutes of [10, 0, -15, 'abc', 99999]) {
            await expect(ctx.useCases.create({ input: { ...VALID, reminder_minutes }, user: COMMON }))
                .rejects.toMatchObject({ statusCode: 400, code: 'REPP_INVALID_REMINDER' });
        }
        expect(ctx.bookingRepository.rows.size).toBe(0);
    });

    describe('edição', () => {
        let ctx;
        let id;
        beforeEach(async () => {
            ctx = setup();
            ({ id } = await ctx.useCases.create({ input: { ...VALID, reminder_minutes: 60 }, user: COMMON }));
            await ctx.useCases.approve({ id, user: ADMIN_AUDITORIO });
            ctx.bookingRepository.rows.get(id).reminder_sent_at = '2026-10-09T13:00:00';
        });

        it('mudar só o título não rearma o lembrete já enviado', async () => {
            const result = await ctx.useCases.update({ id, input: { title: 'Outro' }, user: COMMON });
            expect(result).toMatchObject({ reminder_minutes: 60, reminder_sent_at: '2026-10-09T13:00:00' });
        });

        it('remarcar rearma o lembrete', async () => {
            const result = await ctx.useCases.update({ id, input: { start_time: '16:00', end_time: '17:00' }, user: COMMON });
            expect(result).toMatchObject({ reminder_minutes: 60, reminder_sent_at: null });
        });

        it('criador troca a antecedência (rearma) ou tira o lembrete', async () => {
            const changed = await ctx.useCases.update({ id, input: { reminder_minutes: 15 }, user: COMMON });
            expect(changed).toMatchObject({ reminder_minutes: 15, reminder_sent_at: null });

            const removed = await ctx.useCases.update({ id, input: { reminder_minutes: null }, user: COMMON });
            expect(removed.reminder_minutes).toBeNull();
        });

        it('admin do espaço não muda o lembrete de outra pessoa, mas pode reenviar o mesmo valor', async () => {
            await expect(ctx.useCases.update({ id, input: { reminder_minutes: 15 }, user: ADMIN_AUDITORIO }))
                .rejects.toMatchObject({ statusCode: 403, code: 'REPP_REMINDER_FORBIDDEN' });
            expect(ctx.bookingRepository.rows.get(id).reminder_minutes).toBe(60);

            const same = await ctx.useCases.update({ id, input: { title: 'Pelo admin', reminder_minutes: 60 }, user: ADMIN_AUDITORIO });
            expect(same).toMatchObject({ title: 'Pelo admin', reminder_minutes: 60 });
        });

        it('admin que remarca a reserva de outra pessoa rearma o lembrete dela', async () => {
            const result = await ctx.useCases.update({ id, input: { start_time: '16:00', end_time: '17:00' }, user: ADMIN_AUDITORIO });
            expect(result).toMatchObject({ status: 'approved', reminder_minutes: 60, reminder_sent_at: null });
        });
    });
});
