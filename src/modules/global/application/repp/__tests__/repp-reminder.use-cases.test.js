/**
 * @fileoverview Ciclo do worker de lembretes com fake em memória.
 *
 * O que decide "vencido" é o SQL (`repp-reminder.queries`) e fica para o e2e;
 * aqui, o que o ciclo faz com o que a consulta devolve: carimba, avisa só o
 * criador, publica depois de gravar e não deixa uma falha segurar as outras.
 */

const { ReppReminderUseCases } = require('../reminder/repp-reminder.use-cases');
const { ReminderRepositoryPort } = require('../reminder/ports/reminder-repository.port');

const BOOKING = {
    id: 7, space_id: 2, space_name: 'Auditório', booking_date: '2026-10-20', start_time: '14:00', end_time: '15:00',
    status: 'approved', title: 'Integração', requester_name: 'COMUM', created_by: 300, reminder_minutes: 30,
};

class FakeReminderRepository extends ReminderRepositoryPort {
    constructor(bookings) {
        super();
        this.bookings = new Map(bookings.map((b) => [b.id, { reminder_sent_at: null, ...b }]));
        this.notifications = [];
        this.failOn = new Set();
    }

    async listDueIds() { return [...this.bookings.keys()]; }

    async withDueReminder(id, work) {
        if (this.failOn.has(id)) throw new Error('deadlock');
        const booking = this.bookings.get(id);
        // Já carimbada = já não está vencida (cobre o segundo worker).
        if (!booking || booking.reminder_sent_at) return null;
        const staged = { sent: false, notices: [] };
        const result = await work({
            booking: { ...booking },
            markSent: async () => { staged.sent = true; },
            insertNotification: async (notice) => {
                staged.notices.push(notice);
                return this.notifications.length + staged.notices.length;
            },
        });
        // "commit"
        if (staged.sent) booking.reminder_sent_at = '2026-10-20T13:30:00';
        this.notifications.push(...staged.notices);
        return result;
    }
}

function setup(bookings = [BOOKING]) {
    const reminderRepository = new FakeReminderRepository(bookings);
    const eventPublisher = { publish: jest.fn(async () => {}) };
    const logError = jest.fn();
    const useCases = new ReppReminderUseCases({ reminderRepository, eventPublisher, logError });
    return { useCases, reminderRepository, eventPublisher, logError };
}

describe('lembretes — ciclo do worker', () => {
    it('avisa o criador com o snapshot da reserva, sem autor, e publica com o id gravado', async () => {
        const ctx = setup();
        await expect(ctx.useCases.runCycle()).resolves.toEqual({ due: 1, sent: 1, failed: 0 });

        expect(ctx.reminderRepository.notifications).toEqual([{
            user_id: 300, booking_id: 7, action: 'reminder', by_user_id: null,
            payload: {
                space_name: 'Auditório', booking_date: '2026-10-20', start_time: '14:00', end_time: '15:00',
                title: 'Integração', requester_name: 'COMUM', by_name: null, reason: null, previous: null,
            },
        }]);
        expect(ctx.reminderRepository.bookings.get(7).reminder_sent_at).not.toBeNull();
        expect(ctx.eventPublisher.publish).toHaveBeenCalledWith(300, expect.objectContaining({
            id: 1, action: 'reminder', booking_id: 7, by_user_id: null, start_time: '14:00',
        }));
    });

    it('nunca envia duas vezes: o segundo ciclo encontra a reserva carimbada', async () => {
        const ctx = setup();
        await ctx.useCases.runCycle();
        await expect(ctx.useCases.runCycle()).resolves.toEqual({ due: 1, sent: 0, failed: 0 });
        expect(ctx.reminderRepository.notifications).toHaveLength(1);
        expect(ctx.eventPublisher.publish).toHaveBeenCalledTimes(1);
    });

    it('reserva sem criador é carimbada sem aviso — não volta a cada ciclo', async () => {
        const ctx = setup([{ ...BOOKING, created_by: null }]);
        await expect(ctx.useCases.runCycle()).resolves.toEqual({ due: 1, sent: 0, failed: 0 });
        expect(ctx.reminderRepository.notifications).toEqual([]);
        expect(ctx.reminderRepository.bookings.get(7).reminder_sent_at).not.toBeNull();
        expect(ctx.eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('falha numa reserva não segura as outras, e ela fica para o próximo ciclo', async () => {
        const ctx = setup([BOOKING, { ...BOOKING, id: 8, created_by: 301 }]);
        ctx.reminderRepository.failOn.add(7);
        await expect(ctx.useCases.runCycle()).resolves.toEqual({ due: 2, sent: 1, failed: 1 });
        expect(ctx.reminderRepository.notifications.map((n) => n.booking_id)).toEqual([8]);
        expect(ctx.reminderRepository.bookings.get(7).reminder_sent_at).toBeNull();
        expect(ctx.logError).toHaveBeenCalledWith(expect.stringContaining('booking id=7'));
    });
});
