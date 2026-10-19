const { normalizeReminder, reminderAfterEdit } = require('../reminder.rules');
const { REMINDER_OPTIONS } = require('../repp.enums');

describe('normalizeReminder', () => {
    it('ausente fica ausente; nulo e vazio = sem lembrete', () => {
        expect(normalizeReminder(undefined)).toBeUndefined();
        expect(normalizeReminder(null)).toBeNull();
        expect(normalizeReminder('')).toBeNull();
    });

    it('aceita só as opções da lista (número ou texto numérico)', () => {
        for (const minutes of REMINDER_OPTIONS) expect(normalizeReminder(minutes)).toBe(minutes);
        expect(normalizeReminder('30')).toBe(30);
        for (const bad of [0, 10, 45, -30, 1.5, 'x', true, {}]) {
            expect(() => normalizeReminder(bad)).toThrow(expect.objectContaining({ statusCode: 400, code: 'REPP_INVALID_REMINDER' }));
        }
    });
});

describe('reminderAfterEdit', () => {
    const current = { reminder_minutes: 60 };

    it('ausente mantém; remarcação rearma', () => {
        expect(reminderAfterEdit({ current, value: undefined, scheduling: false, byCreator: true }))
            .toEqual({ reminder_minutes: 60, reset_reminder: false });
        expect(reminderAfterEdit({ current, value: undefined, scheduling: true, byCreator: false }))
            .toEqual({ reminder_minutes: 60, reset_reminder: true });
    });

    it('criador muda ou tira — e mudar rearma', () => {
        expect(reminderAfterEdit({ current, value: 15, scheduling: false, byCreator: true }))
            .toEqual({ reminder_minutes: 15, reset_reminder: true });
        expect(reminderAfterEdit({ current, value: null, scheduling: false, byCreator: true }))
            .toEqual({ reminder_minutes: null, reset_reminder: true });
    });

    it('outra pessoa: mesmo valor passa, valor diferente é 403', () => {
        expect(reminderAfterEdit({ current: { reminder_minutes: '60' }, value: 60, scheduling: false, byCreator: false }))
            .toEqual({ reminder_minutes: 60, reset_reminder: false });
        expect(() => reminderAfterEdit({ current, value: 30, scheduling: false, byCreator: false }))
            .toThrow(expect.objectContaining({ statusCode: 403, code: 'REPP_REMINDER_FORBIDDEN' }));
        expect(() => reminderAfterEdit({ current: { reminder_minutes: null }, value: 30, scheduling: false, byCreator: false }))
            .toThrow(expect.objectContaining({ code: 'REPP_REMINDER_FORBIDDEN' }));
    });
});
