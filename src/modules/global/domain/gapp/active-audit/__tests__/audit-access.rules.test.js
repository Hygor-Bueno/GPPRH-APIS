const {
    assigneeIds, isRequester, isAssignee, canRegister, normalizeAssignees, MAX_ASSIGNEES,
} = require('../audit-access.rules');

// Como vem do banco: GROUP_CONCAT dos responsáveis
const AUDIT = { user_open_id_fk: 10, assignee_ids: '20,31' };

describe('audit-access.rules', () => {
    test('quem abriu é o solicitante (id como texto também vale)', () => {
        expect(isRequester(AUDIT, 10)).toBe(true);
        expect(isRequester(AUDIT, '10')).toBe(true);
        expect(isRequester(AUDIT, 20)).toBe(false);
        expect(isRequester(null, 10)).toBe(false);
    });

    test('ids dos responsáveis: do GROUP_CONCAT, da lista ou nenhum', () => {
        expect(assigneeIds(AUDIT)).toEqual([20, 31]);
        expect(assigneeIds({ assignee_ids: [20] })).toEqual([20]);
        expect(assigneeIds({ assignee_ids: null })).toEqual([]);
        expect(isAssignee(AUDIT, 31)).toBe(true);
        expect(isAssignee({ assignee_ids: null }, null)).toBe(false);
    });

    test('conferem o solicitante e qualquer responsável; os outros não', () => {
        expect(canRegister(AUDIT, 10)).toBe(true);
        expect(canRegister(AUDIT, 20)).toBe(true);
        expect(canRegister(AUDIT, 31)).toBe(true);
        expect(canRegister(AUDIT, 30)).toBe(false);
        expect(canRegister(AUDIT, undefined)).toBe(false);
    });

    test('normalizeAssignees: vazio = nenhum; tira repetidos e quem abriu', () => {
        expect(normalizeAssignees(null)).toEqual({ value: [] });
        expect(normalizeAssignees(undefined)).toEqual({ value: [] });
        expect(normalizeAssignees(['20', 31, 20, 10], 10)).toEqual({ value: [20, 31] });
    });

    test('normalizeAssignees: não lista, id inválido ou acima do teto é erro', () => {
        expect(normalizeAssignees(20).error).toBeTruthy();
        expect(normalizeAssignees([0]).error).toBeTruthy();
        expect(normalizeAssignees([1.5]).error).toBeTruthy();
        expect(normalizeAssignees(['abc']).error).toBeTruthy();
        const many = Array.from({ length: MAX_ASSIGNEES + 1 }, (_, index) => index + 1);
        expect(normalizeAssignees(many).error).toMatch(String(MAX_ASSIGNEES));
    });
});
