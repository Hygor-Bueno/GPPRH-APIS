/**
 * @fileoverview Espelho dos ENUMs do schema `cppp_*` (MySQL `global`) e das
 * categorias que a suite usa em memória.
 *
 * Todo valor de ENUM aqui É o texto gravado na coluna — o schema de validação
 * (`schemas/cppp.schema.js`) usa estas listas para recusar valor inválido com
 * 400 antes de o MySQL devolver o erro 1265 como 500.
 *
 * @module modules/global/domain/cppp/cppp.enums
 */

/**
 * Tipos de registro do AFD (Portaria 671/2021) que a carga grava em
 * `cppp_afd_records.record_type`. O 1 (cabeçalho) e o 9 (trailer) existem no
 * arquivo, mas não são registros com NSR — ficam só no AFD bruto.
 */
const AfdRecordType = Object.freeze({
    EMPRESA:   2, // inclusão/alteração dos dados do empregador
    MARCACAO:  3, // marcação de ponto
    AJUSTE:    4, // ajuste do relógio do equipamento
    CADASTRO:  5, // inclusão/alteração/exclusão de empregado no REP
    EVENTO:    6, // evento sensível do equipamento — NÃO é justificativa
});

/** `cppp_collect_runs.status` */
const CollectRunStatus = Object.freeze({
    // A mais que o documento de origem: a rota de coleta não executa nada, só
    // enfileira — quem fala com o relógio é o worker. Ver `docs/cppp.md`.
    QUEUED:  'queued',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED:  'failed',
});

/** `cppp_collect_runs.trigger_source` */
const CollectTrigger = Object.freeze({
    SCHEDULE: 'schedule',
    MANUAL:   'manual',
});

/** `cppp_collect_runs.trailer_check` */
const TrailerCheck = Object.freeze({
    OK:       'ok',
    MISMATCH: 'mismatch',
    ABSENT:   'absent',
});

/** `cppp_punch_adjustments.type` */
const AdjustmentType = Object.freeze({
    BATIDA_ESQUECIDA:      'batida_esquecida',
    // Não estava na lista do documento de origem: nenhum dos outros tipos
    // resolve uma leitura duplicada. Aponta o NSR e não apaga nada.
    DESCONSIDERAR_LEITURA: 'desconsiderar_leitura',
    ATESTADO:              'atestado',
    DECLARACAO_HORAS:      'declaracao_horas',
    ABONO:                 'abono',
    FERIAS:                'ferias',
    FOLGA:                 'folga',
    FALTA_JUSTIFICADA:     'falta_justificada',
});

/** Regras de detecção — nomes herdados do ETL Python, sem tradução. */
const IssueType = Object.freeze({
    BATIDA_UNICA: 'batida_unica',
    BATIDA_IMPAR: 'batida_impar',
    DUPLICADA:    'duplicada',
    FECHA_CEDO:   'fecha_cedo',
});

/** Situação de uma ocorrência na tela. */
const IssueStatus = Object.freeze({
    PENDENTE: 'pendente',
    TRATADA:  'tratada',
});

/** As duas visões de marcação: a fiscal e a que a folha consome. */
const PunchView = Object.freeze({
    AFD:     'afd',
    TRATADA: 'tratada',
});

/** Helper para os schemas: `values(AdjustmentType)` → `['batida_esquecida', ...]`. */
const values = (frozenEnum) => Object.values(frozenEnum);

module.exports = {
    AfdRecordType,
    CollectRunStatus,
    CollectTrigger,
    TrailerCheck,
    AdjustmentType,
    IssueType,
    IssueStatus,
    PunchView,
    values,
};
