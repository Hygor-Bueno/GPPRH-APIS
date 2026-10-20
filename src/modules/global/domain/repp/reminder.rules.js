/**
 * @fileoverview Lembrete da reserva: o que entra em `reminder_minutes` e
 * quando o lembrete precisa ser rearmado.
 *
 * Decisões do Hygor, 19/10/2026:
 *   - só o CRIADOR recebe o lembrete, e por isso só ele escolhe a antecedência;
 *   - só reserva APROVADA dispara. A pendente guarda a escolha e dispara se for
 *     aprovada antes de começar;
 *   - lembrete cujo horário já passou dispara na hora — administrador que
 *     reserva para daqui a 20 min com lembrete de 1 h, ou aprovação que chega
 *     depois do horário do lembrete.
 *
 * Quem dispara é o worker `repp-reminder` (`application/repp/reminder`); aqui
 * fica só a entrada e o rearme. `reminder_sent_at` NULL = ainda não enviado.
 *
 * @module modules/global/domain/repp/reminder.rules
 */

const { AppError } = require('../../../../errors/app.error');
const { REMINDER_OPTIONS, ReppErrorCode } = require('./repp.enums');

const toMinutes = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * `reminder_minutes` do corpo.
 * @returns {number|null|undefined} `undefined` = ausente (fica como está);
 *   `null` = sem lembrete; número = uma das `REMINDER_OPTIONS`.
 */
function normalizeReminder(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const minutes = Number(value);
    if (REMINDER_OPTIONS.includes(minutes)) return minutes;
    throw new AppError(
        `O campo 'reminder_minutes' deve ser um destes valores: ${REMINDER_OPTIONS.join(', ')} (ou nulo, para não lembrar).`,
        400,
        { code: ReppErrorCode.InvalidReminder },
    );
}

/**
 * Lembrete depois de uma edição.
 *
 * Só o criador muda a antecedência; outra pessoa que manda o MESMO valor (o
 * formulário reenvia o que carregou) passa. O lembrete é rearmado quando
 * muda o espaço, a data ou o horário, ou a própria antecedência — o aviso
 * já enviado falava de outro horário.
 *
 * @param {object} params
 * @param {object}  params.current    - a reserva antes da edição.
 * @param {*}       params.value      - `input.reminder_minutes`, cru.
 * @param {boolean} params.scheduling - `isSchedulingChange(current, next)`.
 * @param {boolean} params.byCreator  - quem edita é o criador.
 * @returns {{reminder_minutes: ?number, reset_reminder: boolean}}
 */
function reminderAfterEdit({ current, value, scheduling, byCreator }) {
    const before = toMinutes(current.reminder_minutes);
    const requested = normalizeReminder(value);
    const after = requested === undefined ? before : requested;
    const changed = after !== before;
    if (changed && !byCreator) {
        throw new AppError('Só quem criou a reserva pode alterar o lembrete.', 403, { code: ReppErrorCode.ReminderForbidden });
    }
    return { reminder_minutes: after, reset_reminder: scheduling || changed };
}

module.exports = { normalizeReminder, reminderAfterEdit };
