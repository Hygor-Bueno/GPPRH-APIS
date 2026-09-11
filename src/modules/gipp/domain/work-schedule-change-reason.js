/**
 * @fileoverview Motivos de mudança de status da jornada (`change_reason`).
 *
 * Texto de domínio, fixo no código. Nunca vem do cliente: `change_reason` é
 * coluna de trilha de auditoria e aceitar texto livre do frontend permitiria
 * gravar qualquer justificativa em cima de uma transição financeira. Se um dia
 * for preciso deixar o usuário complementar o motivo, o caminho é um campo
 * separado e validado — não substituir estes valores.
 *
 * O trigger `trg_cf_work_schedules_status_history` grava o motivo tal como
 * chega no `SESSION_CONTEXT`, exceto no `INITIAL_STATE`, onde ele aplica
 * `COALESCE(@ChangeReason, 'Marcação criada.')`. Ou seja: mandar o motivo do
 * INITIAL_STATE daqui é o que substitui aquele texto genérico.
 *
 * @module modules/gipp/domain/work-schedule-change-reason
 */

const CHANGE_REASON = Object.freeze({
    /** INSERT em cf_work_schedules — entrada registrada (status 1). */
    CREATED: 'Compra de folga criada',

    /** 1 → 2, disparado por `pcr_put_status_cf_work_schedule` na saída. */
    SENT_TO_APPROVAL: 'Compra de folga enviada para aprovação',

    /** 2 → 3, aprovação do gerente. */
    APPROVED_BY_MANAGER: 'Compra de folga aprovada pelo gerente',

    /** 3 → 6, `pcr_process_work_schedules` grava os valores calculados. */
    CALCULATION_STARTED: 'Cálculo financeiro iniciado',

    /** Fechamento do RH concluído — recibo gerado. */
    CALCULATION_FINISHED: 'Cálculo financeiro concluído',

    /** 6 → 4, confirmação da tesouraria depois da impressão. */
    PAYMENT_FINISHED: 'Pagamento concluído',

    /** 6 → 3, devolução à fila do RH quando o recibo não pôde ser gerado. */
    REVERTED_TO_PAYROLL: 'Cálculo financeiro revertido — recibo não gerado',

    /**
     * 4 → 6, desfazendo o fechamento automático da impressão consolidada quando
     * o PDF não chegou ao cliente. É a única transição que sai do 4: existe para
     * que uma entrega interrompida não deixe a jornada finalizada sem recibo
     * impresso, o que a interface não tem como corrigir.
     */
    PAYMENT_REVERTED: 'Pagamento revertido — recibo não entregue',

    /** → 5, desconsiderada pelo encarregado, gerente ou RH. */
    CANCELLED: 'Compra de folga cancelada',
});

module.exports = { CHANGE_REASON };
