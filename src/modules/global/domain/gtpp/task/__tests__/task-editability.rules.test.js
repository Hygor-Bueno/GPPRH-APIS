const { isTaskEditable, assertTaskEditable } = require('../task-editability.rules');
const { AppError } = require('../../../../../../errors/app.error');

describe('task-editability.rules', () => {
    it.each([1, 2, 3, 4])('state %i should be editable', (stateId) => {
        expect(isTaskEditable(stateId)).toBe(true);
        expect(() => assertTaskEditable(stateId)).not.toThrow();
    });

    it.each([5, 6, 7, 8])('state %i should NOT be editable', (stateId) => {
        expect(isTaskEditable(stateId)).toBe(false);
        expect(() => assertTaskEditable(stateId)).toThrow(AppError);
    });
});
