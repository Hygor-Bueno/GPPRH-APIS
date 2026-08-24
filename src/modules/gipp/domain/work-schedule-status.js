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
    /** "Incompleto" — entrada registrada, ainda sem saída. Transitório. */
    OPEN: 1,

    /** "Aprovando" — jornada fechada pelo encarregado, na fila do gerente. */
    AWAITING_APPROVAL: 2,

    /** "Calculando" — aprovada pelo gerente, na fila do RH. */
    AWAITING_PAYROLL: 3,

    /**
     * "Pagando" — o RH gerou os recibos; a tesouraria está imprimindo e
     * finalizando os pagamentos.
     *
     * A partir daqui a jornada **não pode mais ser cancelada por ninguém via
     * software**: os recibos já existem, e desfazer exigiria estorná-los.
     */
    PAYING: 6,

    /** "Finalizado" — tesouraria encerrou. Estado final. */
    FINISHED: 4,

    /** "Cancelado" — desconsiderada. Estado final. */
    CANCELLED: 5,
});

/**
 * Ordem real do fluxo, conforme `cf_status.workflow_order`.
 *
 * ⚠️ Não ordene por `id_status`: o 6 foi criado depois e ficaria no fim, quando
 * na verdade vem antes do 4. E o 5 (cancelado) está fora da linha, com ordem 0.
 */
const WORKFLOW_ORDER = Object.freeze({
    [WORK_SCHEDULE_STATUS.CANCELLED]: 0,
    [WORK_SCHEDULE_STATUS.OPEN]: 1,
    [WORK_SCHEDULE_STATUS.AWAITING_APPROVAL]: 2,
    [WORK_SCHEDULE_STATUS.AWAITING_PAYROLL]: 3,
    [WORK_SCHEDULE_STATUS.PAYING]: 4,
    [WORK_SCHEDULE_STATUS.FINISHED]: 5,
});

/**
 * O que a operação (encarregado e web) enxerga: tudo que ainda não encerrou.
 * Exclui apenas finalizada (4) e cancelada (5).
 */
const OPERATION_VISIBLE_STATUSES = Object.freeze([
    WORK_SCHEDULE_STATUS.OPEN,
    WORK_SCHEDULE_STATUS.AWAITING_APPROVAL,
    WORK_SCHEDULE_STATUS.AWAITING_PAYROLL,
    WORK_SCHEDULE_STATUS.PAYING,
]);

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
 * O que o RH pode desconsiderar — inclui a jornada aprovada (3), que está na
 * fila dele e ainda não virou recibo.
 *
 * `PAYING` (6) e `FINISHED` (4) ficam de fora **para todos**: depois que o RH
 * gera os recibos a jornada não pode mais ser cancelada por ninguém via
 * software. Desfazer exigiria estornar `gipp_payment_receipt` e `cf_payments`,
 * o que este endpoint não faz — cancelar sem estornar deixaria o recibo órfão.
 */
const PAYROLL_DISCARDABLE_STATUSES = Object.freeze([
    WORK_SCHEDULE_STATUS.OPEN,
    WORK_SCHEDULE_STATUS.AWAITING_APPROVAL,
    WORK_SCHEDULE_STATUS.AWAITING_PAYROLL,
]);

module.exports = {
    WORK_SCHEDULE_STATUS,
    WORKFLOW_ORDER,
    OPERATION_VISIBLE_STATUSES,
    LEGACY_PAYMENT_STATUSES,
    DISCARDABLE_STATUSES,
    PAYROLL_DISCARDABLE_STATUSES,
};
