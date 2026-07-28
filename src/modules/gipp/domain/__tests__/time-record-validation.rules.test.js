const { validateTimeRecords } = require('../time-record-validation.rules');
const { AppError } = require('../../../../errors/app.error');

describe('time-record-validation.rules', () => {
    it('should throw 422 when there is no entry record', () => {
        const records = [{ id_record_type_fk: 4 }]; // só saída
        expect(() => validateTimeRecords(records, 'WS1')).toThrow(AppError);
    });

    it('should throw 422 when break start/end pairs are mismatched', () => {
        const records = [
            { id_record_type_fk: 1 }, // entrada
            { id_record_type_fk: 2 }, // início intervalo
            { id_record_type_fk: 2 }, // início intervalo (sem fim correspondente)
            { id_record_type_fk: 3 }, // fim intervalo
        ];
        expect(() => validateTimeRecords(records, 'WS1')).toThrow(AppError);
    });

    it('should accept a partial journey with no exit record', () => {
        const records = [{ id_record_type_fk: 1 }];
        const result = validateTimeRecords(records, 'WS1');
        expect(result).toEqual({ entry: records[0], exit: null, hasExit: false });
    });

    it('should accept a complete journey with matched break pairs and an exit', () => {
        const records = [
            { id_record_type_fk: 1, id: 'entry' },
            { id_record_type_fk: 2 },
            { id_record_type_fk: 3 },
            { id_record_type_fk: 4, id: 'exit' },
        ];
        const result = validateTimeRecords(records, 'WS1');
        expect(result.hasExit).toBe(true);
        expect(result.entry.id).toBe('entry');
        expect(result.exit.id).toBe('exit');
    });

    it('should accept a journey with zero breaks', () => {
        const records = [{ id_record_type_fk: 1 }, { id_record_type_fk: 4 }];
        expect(() => validateTimeRecords(records, 'WS1')).not.toThrow();
    });
});
