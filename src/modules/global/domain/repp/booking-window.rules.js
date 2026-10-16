/**
 * @fileoverview Regras de agenda da REPP: até quando, a partir de quando e em
 * que dias da semana se reserva, e a folga de organização entre reservas.
 *
 * | Regra                         | Vale para                       | Configuração                     |
 * |-------------------------------|---------------------------------|----------------------------------|
 * | dia da semana bloqueado       | quem não administra o espaço    | `re_spaces.blocked_weekdays`     |
 * | data liberada no dia bloqueado| (exceção ao bloqueio)           | `re_space_unblocked_dates`       |
 * | mínimo de 24h de antecedência | quem não administra o espaço    | `MIN_ADVANCE_HOURS`              |
 * | até a mesma data daqui a 2 meses | quem não administra o espaço | `MAX_ADVANCE_MONTHS`             |
 * | folga de organização          | TODO MUNDO                      | `re_spaces.setup_minutes`        |
 *
 * "Quem administra" = administrador do espaço (`re_space_admins`) ou dono do
 * sistema — o mesmo `canReviewSpace` que decide a aprovação automática. A
 * folga não tem exceção: é o tempo físico de arrumar o espaço.
 *
 * Decisões do Hygor, 15/10/2026: bloqueio de terça e quinta só no Auditório;
 * o administrador reserva nesses dias e pode liberar uma data específica para
 * os demais; a janela de 2 meses conta até o mesmo dia (15/10 → 15/12; em mês
 * mais curto, o último dia: 31/12 → 28/02).
 *
 * Como em `booking.rules`, data e hora são texto de parede local
 * (`2026-10-16`, `14:30`) — o processo roda em `America/Sao_Paulo`.
 *
 * @module modules/global/domain/repp/booking-window.rules
 */

const { AppError } = require('../../../../errors/app.error');
const { MIN_ADVANCE_HOURS, MAX_ADVANCE_MONTHS, ReppErrorCode } = require('./repp.enums');
const { toLocalStamp } = require('./booking.rules');

const pad = (n) => String(n).padStart(2, '0');

const WEEKDAY_NAMES = Object.freeze({
    1: 'segundas-feiras', 2: 'terças-feiras', 3: 'quartas-feiras', 4: 'quintas-feiras',
    5: 'sextas-feiras', 6: 'sábados', 7: 'domingos',
});

/**
 * `'2,4'` (coluna) → `[2, 4]`. Ignora o que não for 1..7 e repetições, para
 * que um erro de digitação no banco não derrube a listagem.
 * @returns {number[]}
 */
function parseWeekdays(value) {
    const days = String(value ?? '').split(',')
        .map((part) => Number(part.trim()))
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
    return [...new Set(days)].sort((a, b) => a - b);
}

/** Dia da semana ISO (1 = segunda … 7 = domingo) de `YYYY-MM-DD`. */
function isoWeekday(date) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day === 0 ? 7 : day;
}

/** `YYYY-MM-DD` local de um `Date`. */
function toLocalDate(now) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `2026-10-16` → `16/10/2026`. */
function formatDateBr(date) {
    const [y, m, d] = date.split('-');
    return `${d}/${m}/${y}`;
}

/**
 * Mesmo dia `months` meses depois; em mês mais curto, o último dia dele
 * (`2026-12-31` + 2 → `2027-02-28`).
 */
function addMonths(date, months) {
    const [y, m, d] = date.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`;
}

/** Primeiro início aceito para quem não administra: agora + 24h, `YYYY-MM-DD HH:MM`. */
function minBookingStamp(now) {
    return toLocalStamp(new Date(now.getTime() + MIN_ADVANCE_HOURS * 3600000));
}

/** Última data aceita para quem não administra. */
function maxBookingDate(now) {
    return addMonths(toLocalDate(now), MAX_ADVANCE_MONTHS);
}

/**
 * Limites de agenda de um espaço para quem consulta — o que vai no
 * `GET /spaces`. Quem administra o espaço recebe `null` nos limites de data
 * (não se aplicam a ele) e `booking_rules_exempt = true`; `blocked_weekdays`
 * sai igual para todos, porque é com ele que o administrador decide o que
 * liberar.
 *
 * @param {{blocked_weekdays: number[], setup_minutes: number}} space
 * @param {boolean} exempt - `canReviewSpace(viewer, space.id)`.
 * @param {Date} now
 */
function bookingLimits(space, exempt, now) {
    return {
        blocked_weekdays: [...space.blocked_weekdays],
        setup_minutes: space.setup_minutes,
        min_booking_at: exempt ? null : minBookingStamp(now).replace(' ', 'T'),
        max_booking_date: exempt ? null : maxBookingDate(now),
        booking_rules_exempt: exempt,
    };
}

/**
 * Antecedência mínima e máxima — quem não administra o espaço. Roda depois
 * de `assertNotPast`, que já cobre o passado com a mensagem própria dele.
 *
 * @param {{booking_date: string, start_time: string}} schedule
 * @param {Date} now
 * @param {{checkStart?: boolean, checkDate?: boolean}} [which]
 *   numa edição, só o que mudou: início (`checkStart`) e/ou data (`checkDate`).
 */
function assertAdvance(schedule, now, { checkStart = true, checkDate = true } = {}) {
    if (checkStart) {
        const min = minBookingStamp(now);
        if (`${schedule.booking_date} ${schedule.start_time}` < min) {
            const [date, time] = min.split(' ');
            const error = new AppError(
                `As reservas precisam ser feitas com pelo menos ${MIN_ADVANCE_HOURS} horas de antecedência. O primeiro horário disponível é ${formatDateBr(date)} às ${time}.`,
                400,
                { code: ReppErrorCode.BookingTooSoon },
            );
            error.fields = { min_booking_at: `${date}T${time}` };
            throw error;
        }
    }
    if (checkDate) {
        const max = maxBookingDate(now);
        if (schedule.booking_date > max) {
            const error = new AppError(
                `Só é possível reservar com até ${MAX_ADVANCE_MONTHS} meses de antecedência, ou seja, até ${formatDateBr(max)}.`,
                400,
                { code: ReppErrorCode.BookingTooFar },
            );
            error.fields = { max_booking_date: max };
            throw error;
        }
    }
}

/**
 * Dia da semana bloqueado no espaço e não liberado para essa data — quem não
 * administra o espaço.
 *
 * @param {{booking_date: string}} schedule
 * @param {{name: string, blocked_weekdays: number[]}} space
 * @param {boolean} unblocked - a data está em `re_space_unblocked_dates`.
 */
function assertWeekdayAllowed(schedule, space, unblocked) {
    const weekday = isoWeekday(schedule.booking_date);
    if (!space.blocked_weekdays.includes(weekday) || unblocked) return;
    const error = new AppError(
        `O espaço ${space.name} não aceita reservas às ${WEEKDAY_NAMES[weekday]}. Fale com o administrador do espaço se precisar desta data.`,
        400,
        { code: ReppErrorCode.BookingWeekdayBlocked },
    );
    error.fields = { booking_date: schedule.booking_date, weekday, blocked_weekdays: [...space.blocked_weekdays] };
    throw error;
}

/** Data que o administrador quer liberar: hoje ou depois, num dia bloqueado do espaço. */
function assertUnblockable(date, space, now) {
    if (date < toLocalDate(now)) {
        throw new AppError('Não é possível liberar uma data que já passou.', 400, { code: ReppErrorCode.BookingInPast });
    }
    const weekday = isoWeekday(date);
    if (!space.blocked_weekdays.includes(weekday)) {
        const error = new AppError(
            `O espaço ${space.name} não bloqueia as ${WEEKDAY_NAMES[weekday]}; não há o que liberar nesta data.`,
            400,
            { code: ReppErrorCode.DateNotBlocked },
        );
        error.fields = { date, weekday, blocked_weekdays: [...space.blocked_weekdays] };
        throw error;
    }
}

// ─── Folga de organização ───────────────────────────────────────────────────

const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toTime = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
/** Reserva não cruza meia-noite: a folga para no começo e no fim do dia. */
const DAY_END = 23 * 60 + 59;

/**
 * Intervalo em que NENHUMA outra reserva pode encostar: a reserva mais a
 * folga dos dois lados, preso ao dia. Com folga 0 é a própria reserva.
 * @returns {{start_time: string, end_time: string}}
 */
function setupWindow({ start_time, end_time }, setupMinutes) {
    return {
        start_time: toTime(Math.max(0, toMinutes(start_time) - setupMinutes)),
        end_time: toTime(Math.min(DAY_END, toMinutes(end_time) + setupMinutes)),
    };
}

/**
 * Das reservas que cruzam a janela com folga, a que explica a recusa:
 * sobreposição de verdade primeiro; senão, a primeira que só invade a folga.
 *
 * @param {{start_time: string, end_time: string}[]} rows - por início.
 * @param {{start_time: string, end_time: string}} schedule
 * @returns {?{conflict: object, kind: 'overlap'|'setup'}}
 */
function pickConflict(rows, schedule) {
    if (!rows.length) return null;
    const overlap = rows.find((row) => row.start_time < schedule.end_time && row.end_time > schedule.start_time);
    return overlap ? { conflict: overlap, kind: 'overlap' } : { conflict: rows[0], kind: 'setup' };
}

module.exports = {
    WEEKDAY_NAMES,
    parseWeekdays,
    isoWeekday,
    toLocalDate,
    formatDateBr,
    addMonths,
    minBookingStamp,
    maxBookingDate,
    bookingLimits,
    assertAdvance,
    assertWeekdayAllowed,
    assertUnblockable,
    setupWindow,
    pickConflict,
};
