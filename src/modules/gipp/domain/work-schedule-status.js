/**
 * @fileoverview Status de jornada de trabalho (`GIPP.dbo.cf_status`).
 *
 * ⚠️ Os rótulos gravados em `cf_status` não descrevem bem o papel de cada
 * status no fluxo — 2 se chama "Aprovado" mas significa apenas que a jornada
 * foi fechada pelo encarregado, e 3 se chama "Calculando" mas significa que o
 * gerente aprovou. Por isso as constantes abaixo usam nomes do fluxo, com o
 * rótulo do banco anotado ao lado.
 *
 * Fluxo (a partir de 08/2026):
 *
 *   encarregado lança a entrada ............................ 1  OPEN
 *   encarregado lança a saída (automático via SP) .......... 2  AWAITING_APPROVAL
 *   gerente aprova ......................................... 3  AWAITING_PAYROLL
 *   gerente reprova ........................................ 5  CANCELLED
 *   RH finaliza e gera o recibo ............................ 4  FINISHED
 *
 * A transição 1 → 2 é automática: `prc_insert_cf_time_records` chama
 * `pcr_put_status_cf_work_schedule` quando o registro é do tipo 4 (saída).
 *
 * @module modules/gipp/domain/work-schedule-status
 */

const WORK_SCHEDULE_STATUS = Object.freeze({
    /** "Pendente" — entrada registrada, ainda sem saída. Transitório. */
    OPEN: 1,

    /** "Aprovado" — jornada fechada pelo encarregado, na fila do gerente. */
    AWAITING_APPROVAL: 2,

    /** "Calculando" — aprovada pelo gerente, na fila do RH. */
    AWAITING_PAYROLL: 3,

    /** "Finalizado" — recibo gerado pelo RH. Estado final. */
    FINISHED: 4,

    /** "Cancelado" — desconsiderada. Estado final. */
    CANCELLED: 5,
});

/**
 * Status que a rota histórica `GET /gipp/time-records/payment` devolve.
 * Antes de 08/2026 esse recorte era herdado da view `vw_work_records`; hoje
 * a view aceita `IN (1,2,3)` e a restrição vive na query da API.
 */
const LEGACY_PAYMENT_STATUSES = Object.freeze([
    WORK_SCHEDULE_STATUS.OPEN,
    WORK_SCHEDULE_STATUS.AWAITING_APPROVAL,
]);

/**
 * O que o encarregado e o gerente podem desconsiderar: jornada aberta e jornada
 * na fila de aprovação. Depois de aprovada ela já é responsabilidade do RH.
 */
const DISCARDABLE_STATUSES = Object.freeze([
    WORK_SCHEDULE_STATUS.OPEN,
    WORK_SCHEDULE_STATUS.AWAITING_APPROVAL,
]);

/**
 * O que o RH pode desconsiderar — inclui a jornada já aprovada (3), que está na
 * fila dele e ainda não virou recibo.
 *
 * `FINISHED` (4) fica de fora para todos: desfazer jornada paga exige estornar
 * as linhas de `gipp_payment_receipt` e `cf_payments`, o que este endpoint não
 * faz. Cancelar sem estornar deixaria o recibo órfão.
 */
const PAYROLL_DISCARDABLE_STATUSES = Object.freeze([
    WORK_SCHEDULE_STATUS.OPEN,
    WORK_SCHEDULE_STATUS.AWAITING_APPROVAL,
    WORK_SCHEDULE_STATUS.AWAITING_PAYROLL,
]);

module.exports = {
    WORK_SCHEDULE_STATUS,
    LEGACY_PAYMENT_STATUSES,
    DISCARDABLE_STATUSES,
    PAYROLL_DISCARDABLE_STATUSES,
};
