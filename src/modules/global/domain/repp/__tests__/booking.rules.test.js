/**
 * @fileoverview Regras puras da REPP: formato, intervalo, passado,
 * sobreposição, status após edição e mascaramento.
 */

const {
    normalizeDate,
    normalizeTime,
    assertTimeOrder,
    hasStarted,
    assertNotPast,
    normalizeRange,
    normalizeOrganizationCodes,
    overlaps,
    initialStatus,
    statusAfterEdit,
    conflictError,
} = require('../booking.rules');
const { buildViewer, canViewDetails, canManage, canReview, SYSTEM_OWNER } = require('../booking-access.rules');
const { shapeMasked, shapeFor, PUBLIC_FIELDS } = require('../booking.shaper');
const { sqlListBookings } = require('../../../repositories/mysql/repp-booking.queries');

// 08/10/2026 10:00 local
const NOW = new Date(2026, 9, 8, 10, 0, 0);

const SENSITIVE = ['title', 'requester_name', 'company_code', 'company_name', 'branch_code',
    'branch_name', 'cost_center_code', 'cost_center_description', 'created_by', 'created_by_name'];

function booking(overrides = {}) {
    return {
        id: 1, space_id: 1, space_name: 'Auditório', booking_date: '2026-10-09',
        start_time: '09:00', end_time: '10:00', status: 'approved', title: 'Treinamento',
        requester_name: 'Fulano', company_code: '02', company_name: 'PEG PESE', branch_code: '0201',
        branch_name: 'LOJA 1', cost_center_code: '1001', cost_center_description: 'RH',
        created_by: 50, created_by_name: 'FULANO',
        ...overrides,
    };
}

describe('formato de data e hora', () => {
    it('aceita data real e recusa data inexistente', () => {
        expect(normalizeDate('2026-02-28', 'd')).toBe('2026-02-28');
        expect(() => normalizeDate('2026-02-30', 'd')).toThrow(/data válida/);
        expect(() => normalizeDate('08/10/2026', 'd')).toThrow(/data válida/);
    });

    it('normaliza hora com segundos e recusa hora inválida', () => {
        expect(normalizeTime('09:30:00', 't')).toBe('09:30');
        expect(normalizeTime('23:59', 't')).toBe('23:59');
        expect(() => normalizeTime('24:00', 't')).toThrow(/hora válida/);
        expect(() => normalizeTime('9:30', 't')).toThrow(/hora válida/);
    });

    it('fim tem que ser maior que início', () => {
        expect(() => assertTimeOrder('10:00', '10:00')).toThrow(/maior/);
        expect(() => assertTimeOrder('10:00', '09:00')).toThrow(/maior/);
        expect(() => assertTimeOrder('09:00', '10:00')).not.toThrow();
    });
});

describe('passado', () => {
    it('recusa reserva que começa agora ou antes, aceita depois', () => {
        expect(() => assertNotPast({ booking_date: '2026-10-08', start_time: '10:00' }, NOW)).toThrow(/já passou/);
        expect(() => assertNotPast({ booking_date: '2026-10-07', start_time: '23:00' }, NOW)).toThrow(/já passou/);
        expect(() => assertNotPast({ booking_date: '2026-10-08', start_time: '10:01' }, NOW)).not.toThrow();
        expect(hasStarted({ booking_date: '2026-10-08', start_time: '09:59' }, NOW)).toBe(true);
    });
});

describe('intervalo da agenda', () => {
    it('aceita até 62 dias contando as pontas e recusa 63', () => {
        expect(normalizeRange('2026-10-01', '2026-12-01')).toEqual({ start: '2026-10-01', end: '2026-12-01' });
        expect(() => normalizeRange('2026-10-01', '2026-12-02')).toThrow(/62 dias/);
    });

    it('recusa fim antes do início e datas ausentes', () => {
        expect(() => normalizeRange('2026-10-10', '2026-10-01')).toThrow(/anterior/);
        expect(() => normalizeRange(undefined, '2026-10-01')).toThrow(/'start'/);
    });
});

describe('códigos do Protheus', () => {
    it('mantém zero à esquerda e exige o formato', () => {
        expect(normalizeOrganizationCodes({ company_code: '02', branch_code: '0201', cost_center_code: ' 1001 ' }))
            .toEqual({ company_code: '02', branch_code: '0201', cost_center_code: '1001' });
        expect(() => normalizeOrganizationCodes({ company_code: '2', branch_code: '0201', cost_center_code: 'x' })).toThrow(/2 dígitos/);
        expect(() => normalizeOrganizationCodes({ company_code: '02', branch_code: '201', cost_center_code: 'x' })).toThrow(/4 dígitos/);
        expect(() => normalizeOrganizationCodes({ company_code: '02', branch_code: '0201' })).toThrow(/cost_center_code/);
    });
});

describe('sobreposição', () => {
    it('cruzar é conflito; encostar não é', () => {
        const a = { start_time: '09:00', end_time: '10:00' };
        expect(overlaps(a, { start_time: '09:30', end_time: '11:00' })).toBe(true);
        expect(overlaps(a, { start_time: '08:00', end_time: '12:00' })).toBe(true);
        expect(overlaps(a, { start_time: '10:00', end_time: '11:00' })).toBe(false);
        expect(overlaps(a, { start_time: '08:00', end_time: '09:00' })).toBe(false);
    });

    it('o 409 informa só o intervalo, sem dado de quem reservou', () => {
        const error = conflictError({ id: 7, start_time: '09:00', end_time: '10:30' });
        expect(error.statusCode).toBe(409);
        expect(error.code).toBe('REPP_BOOKING_CONFLICT');
        expect(error.message).toContain('09:00');
        expect(error.fields).toEqual({
            conflict: { start_time: '09:00', end_time: '10:30' },
            reason: 'overlap',
            setup_minutes: 0,
            blocked: { start_time: '09:00', end_time: '10:30' },
        });
    });

    it('o 409 da folga de organização diz o intervalo bloqueado', () => {
        const error = conflictError({ id: 7, start_time: '14:00', end_time: '15:00' }, {
            kind: 'setup', setupMinutes: 90, blocked: { start_time: '12:30', end_time: '16:30' },
        });
        expect(error.message).toBe('Este espaço exige um intervalo de 90 minutos entre reservas para organização. Há uma reserva das 14:00 às 15:00, então o intervalo das 12:30 às 16:30 fica bloqueado.');
        expect(error.fields).toMatchObject({ reason: 'setup', setup_minutes: 90 });
        expect(Object.keys(error.fields.conflict)).toEqual(['start_time', 'end_time']);
    });
});

describe('status', () => {
    const current = { space_id: 1, booking_date: '2026-10-09', start_time: '09:00', end_time: '10:00', status: 'approved' };

    it('quem administra reserva direto; os demais vão para a fila', () => {
        expect(initialStatus(true)).toBe('approved');
        expect(initialStatus(false)).toBe('pending');
    });

    it('criador que troca data/horário/espaço volta para pendente', () => {
        expect(statusAfterEdit({ current, next: { ...current, start_time: '09:30' }, canReviewTarget: false })).toBe('pending');
        expect(statusAfterEdit({ current, next: { ...current, booking_date: '2026-10-10' }, canReviewTarget: false })).toBe('pending');
        expect(statusAfterEdit({ current, next: { ...current, space_id: 2 }, canReviewTarget: false })).toBe('pending');
    });

    it('editar só texto não muda o status; quem pode aprovar também não', () => {
        expect(statusAfterEdit({ current, next: { ...current }, canReviewTarget: false })).toBe('approved');
        expect(statusAfterEdit({ current, next: { ...current, start_time: '09:30' }, canReviewTarget: true })).toBe('approved');
        const pending = { ...current, status: 'pending' };
        expect(statusAfterEdit({ current: pending, next: { ...pending, start_time: '09:30' }, canReviewTarget: true })).toBe('pending');
    });
});

describe('acesso e mascaramento', () => {
    const anonymous = buildViewer(null);
    const common = buildViewer({ id: 10, permissions: [] }, []);
    const adminA = buildViewer({ id: 9, permissions: [] }, [1]);
    const owner = buildViewer({ id: 1, permissions: [SYSTEM_OWNER] }, []);
    const creator = buildViewer({ id: 50, permissions: [] }, []);

    it('decide por espaço e por autoria', () => {
        expect(canViewDetails(anonymous, booking())).toBe(false);
        expect(canViewDetails(common, booking())).toBe(false);
        expect(canViewDetails(adminA, booking({ space_id: 1 }))).toBe(true);
        expect(canViewDetails(adminA, booking({ space_id: 2 }))).toBe(false);
        expect(canViewDetails(owner, booking({ space_id: 2 }))).toBe(true);
        expect(canViewDetails(creator, booking({ space_id: 2 }))).toBe(true);
    });

    it('criador gerencia mas não aprova; nada se gerencia depois de começar', () => {
        const pending = booking({ status: 'pending' });
        expect(canManage(creator, pending, NOW)).toBe(true);
        expect(canReview(creator, pending, NOW)).toBe(false);
        expect(canReview(adminA, pending, NOW)).toBe(true);
        const started = booking({ booking_date: '2026-10-08', start_time: '09:00' });
        expect(canManage(adminA, started, NOW)).toBe(false);
        expect(canManage(owner, booking({ status: 'canceled' }), NOW)).toBe(false);
    });

    it('a versão mascarada não tem as chaves sensíveis — nem como null', () => {
        const masked = shapeMasked(booking());
        for (const key of SENSITIVE) expect(masked).not.toHaveProperty(key);
        expect(Object.keys(masked).sort()).toEqual([...PUBLIC_FIELDS, 'can_view_details', 'can_manage', 'can_review'].sort());
        expect(shapeFor(booking({ space_id: 2 }), adminA, NOW)).not.toHaveProperty('title');
        expect(shapeFor(booking({ space_id: 1 }), adminA, NOW)).toHaveProperty('title', 'Treinamento');
    });
});

describe('SQL da agenda', () => {
    const base = { start: '2026-10-01', end: '2026-10-31', spaceId: null };

    it('a consulta mascarada não lê nenhuma coluna sensível', () => {
        const { sql } = sqlListBookings({ ...base, detailed: false, scope: { all: false, spaceIds: [1], userId: 9 } });
        const projection = sql.slice(0, sql.indexOf('FROM'));
        for (const column of ['title', 'requester_name', 'company', 'branch', 'cost_center', 'created_by']) {
            expect(projection).not.toMatch(new RegExp(`b\\.${column}`));
        }
    });

    it('anônimo usa sentinelas, nunca NULL, no recorte', () => {
        const { params } = sqlListBookings({ ...base, detailed: false, scope: { all: false, spaceIds: [], userId: null } });
        expect(params.slice(-2)).toEqual([[0], -1]);
    });
});
