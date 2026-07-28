/**
 * @fileoverview Validação pura dos registros de ponto de uma jornada, antes do fechamento.
 *
 * Regras:
 * - Deve existir pelo menos um registro de entrada (tipo 1).
 * - Os intervalos devem ser completos: cada início (tipo 2) precisa de um fim (tipo 3).
 * - A saída (tipo 4) é opcional — jornadas parciais são aceitas.
 *
 * @module modules/gipp/domain/time-record-validation.rules
 */

const { AppError } = require('../../../errors/app.error');
const { RECORD_TYPE } = require('./record-type.enum');

/**
 * @param {object[]} records - Marcações de ponto da jornada.
 * @param {string} codWorkSchedule - Código da jornada (usado nas mensagens de erro).
 * @returns {{entry: object, exit: object|null, hasExit: boolean}}
 * @throws {AppError} 422 se faltar entrada ou se os pares de intervalo estiverem incompletos.
 */
function validateTimeRecords(records, codWorkSchedule) {
    const entry = records.find(r => r.id_record_type_fk === RECORD_TYPE.ENTRY);
    const exit = records.find(r => r.id_record_type_fk === RECORD_TYPE.EXIT);
    const breaks = records.filter(r =>
        r.id_record_type_fk === RECORD_TYPE.BREAK_START ||
        r.id_record_type_fk === RECORD_TYPE.BREAK_END
    );

    if (!entry) {
        throw new AppError(`Jornada ${codWorkSchedule}: sem registro de entrada (tipo 1).`, 422);
    }

    const breakStarts = breaks.filter(r => r.id_record_type_fk === RECORD_TYPE.BREAK_START);
    const breakEnds = breaks.filter(r => r.id_record_type_fk === RECORD_TYPE.BREAK_END);

    if (breakStarts.length !== breakEnds.length) {
        throw new AppError(
            `Jornada ${codWorkSchedule}: pares de intervalo inválidos ` +
            `(${breakStarts.length} início(s) x ${breakEnds.length} fim(s)).`, 422
        );
    }

    if (!exit) {
        return { entry, exit: null, hasExit: false };
    }

    return { entry, exit, hasExit: true };
}

module.exports = { validateTimeRecords };
