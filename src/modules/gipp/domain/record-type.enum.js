/**
 * @fileoverview Tipos de marcação de ponto GIPP.
 * @module modules/gipp/domain/record-type.enum
 */

const RECORD_TYPE = Object.freeze({
    /** Entrada no trabalho. */
    ENTRY: 1,
    /** Início de intervalo. */
    BREAK_START: 2,
    /** Fim de intervalo. */
    BREAK_END: 3,
    /** Saída do trabalho. */
    EXIT: 4,
});

module.exports = { RECORD_TYPE };
