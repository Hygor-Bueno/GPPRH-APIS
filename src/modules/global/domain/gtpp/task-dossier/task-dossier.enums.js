/**
 * @fileoverview Enums do Dossiê da tarefa (GTPP).
 *
 * @module modules/global/domain/gtpp/task-dossier/task-dossier.enums
 */

'use strict';

/** Códigos de erro do dossiê — o front decide o comportamento pelo `code`. */
const GtppDossierErrorCode = Object.freeze({
    TASK_NOT_FOUND: 'GTPP_DOSSIER_TASK_NOT_FOUND',
    FORBIDDEN:      'GTPP_DOSSIER_FORBIDDEN',
    BUSY:           'GTPP_DOSSIER_BUSY',
    RENDER_FAILED:  'GTPP_DOSSIER_RENDER_FAILED',
    MYSQL_ERROR:    'GTPP_DOSSIER_MYSQL_ERROR',
});

/** Tamanhos (lado maior, px) das miniaturas embutidas no PDF. */
const DossierThumbSize = Object.freeze({
    EVIDENCE: 320,
    AVATAR:   96,
});

module.exports = { GtppDossierErrorCode, DossierThumbSize };
