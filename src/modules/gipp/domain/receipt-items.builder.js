/**
 * @fileoverview Monta, de forma pura, os itens de recibo de fechamento de
 * jornada (horas normais, extras e noturnas), com descrição e duração embutidas.
 *
 * @module modules/gipp/domain/receipt-items.builder
 */

const { formatMinutes } = require('./duration.formatter');

/**
 * `payment_type_id` fixo utilizado no fechamento de jornada GIPP.
 * Corresponde ao tipo "Fechamento de Jornada" na tabela `gipp_payment_types`.
 */
const PAYMENT_TYPE_CLOSING = 6;

/** Converte uma data no formato DD/MM/YYYY para um objeto `Date`. */
function parseWorkDate(workDate) {
    if (!workDate) return null;
    const [day, month, year] = workDate.split('/');
    return new Date(`${year}-${month}-${day}`);
}

/**
 * Monta os itens de recibo correspondendo a cada tipo de lançamento:
 * - N   → Serviços Prestados (horas normais)
 * - HE  → Hora(s) Extra(s)
 * - EXN → Hora(s) Extra(s) Noturna(s)
 *
 * O `event_code` embute o `codWorkSchedule` para garantir unicidade por jornada.
 * Itens com `amount <= 0` são filtrados.
 *
 * @param {object} params
 * @param {object} params.ws - Dados da jornada/colaborador/empresa (`sqlGetWorkScheduleData`).
 * @param {object} params.pay - Valores calculados (`sqlGetPaymentDataByCodWork`).
 * @param {object} params.dur - Durações (`sqlGetWorkDurations`).
 * @param {string|null} params.workDate - Data de trabalho formatada DD/MM/YYYY.
 * @param {string} params.codWorkSchedule
 * @param {string} params.reference - Referência YYYYMM.
 * @param {string} params.receiptGroupId - UUID compartilhado entre os itens desta jornada.
 * @param {string|number|null} params.userId
 * @param {string|number|null} params.userBranchCode
 * @returns {object[]} Itens de recibo (já filtrados por `amount > 0`).
 */
function buildReceiptItems({ ws, pay, dur, workDate, codWorkSchedule, reference, receiptGroupId, userId, userBranchCode }) {
    const basePayload = {
        company_code: ws.company_code != null ? String(ws.company_code) : null,
        branch_code: ws.branch_time_record != null ? String(ws.branch_time_record).padStart(4, '0') : null,
        employee_code: ws.employee_id != null ? String(ws.employee_id).padStart(6, '0') : null,
        employee_name: ws.employee_name != null ? String(ws.employee_name) : null,
        branch_name: ws.branch_name != null ? String(ws.branch_name) : null,
        work_schedule_id: codWorkSchedule,
        reference,
        reference_date: parseWorkDate(workDate),
        movement_type: 'E',
        is_active: 1,
        receipt_group_id: receiptGroupId,
        payment_type_id: PAYMENT_TYPE_CLOSING,
        created_by: userId != null ? String(userId) : null,
        created_by_branch_code: userBranchCode != null ? String(userBranchCode) : null,
        payee_id: null,
    };

    // FullExpedient indica jornada completa → exibe "1d" ao invés da duração em horas
    const refNormal = dur?.FullExpedient ? '1d' : formatMinutes(dur?.WorkMinutes);
    const refExtra = formatMinutes(dur?.WorkExtraMinutes);
    const refNight = formatMinutes(dur?.NightMinutes);

    const datePrefix = workDate ? `${workDate} - ` : '';

    return [
        {
            ...basePayload,
            description: `${datePrefix}Serviços Prestados${refNormal ? ` - ${refNormal}` : ''}`,
            amount: pay.normal_payment,
            event_code: `N|${codWorkSchedule}`,
        },
        {
            ...basePayload,
            description: `${datePrefix}Hora(s) Extra(s)${refExtra ? ` - ${refExtra}` : ''}`,
            amount: pay.extra_hour_payment,
            event_code: `HE|${codWorkSchedule}`,
        },
        {
            ...basePayload,
            description: `${datePrefix}Hora(s) Extra(s) Noturna(s)${refNight ? ` - ${refNight}` : ''}`,
            amount: pay.night_bonus_payment,
            event_code: `EXN|${codWorkSchedule}`,
        },
    ].filter(item => item.amount > 0);
}

module.exports = { buildReceiptItems, parseWorkDate, PAYMENT_TYPE_CLOSING };
