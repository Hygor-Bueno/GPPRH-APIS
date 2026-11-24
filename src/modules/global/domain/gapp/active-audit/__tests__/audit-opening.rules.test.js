const {
    dateKey, normalizeDeadline, normalizeScope, scopeNameError, normalizeOpenAudit, isOverdue,
} = require('../audit-opening.rules');

const NOW = new Date(2026, 10, 24, 15, 30);
const BODY = { audit_name: 'Inventário', scope: [{ company_code: '02', branch_code: '0202' }] };

describe('audit-opening.rules', () => {
    test('nome obrigatório (sem espaços nas pontas) e com no máximo 150 caracteres', () => {
        expect(normalizeOpenAudit({ ...BODY, audit_name: '   ' }, NOW).error).toMatch(/nome/);
        expect(normalizeOpenAudit({ ...BODY, audit_name: 'x'.repeat(151) }, NOW).error).toMatch(/150/);
        expect(normalizeOpenAudit({ ...BODY, audit_name: '  Inventário  ' }, NOW).value.name).toBe('Inventário');
    });

    test('prazo: opcional, data real, a partir de hoje', () => {
        expect(normalizeDeadline('', NOW)).toEqual({ value: null });
        expect(normalizeDeadline('2026-11-24', NOW)).toEqual({ value: '2026-11-24' });
        expect(normalizeDeadline('2026-11-23', NOW).error).toMatch(/anterior/);
        expect(normalizeDeadline('2026-02-30', NOW).error).toMatch(/inválido/);
        expect(normalizeDeadline('24/11/2026', NOW).error).toMatch(/inválido/);
    });

    test('escopo: ao menos uma loja, códigos como texto (zeros à esquerda), centro de custo opcional', () => {
        expect(normalizeScope([]).error).toMatch(/ao menos uma loja/);
        expect(normalizeScope([{ company_code: '02' }]).error).toMatch(/Escopo 1/);
        expect(normalizeScope([{ company_code: ' 02 ', branch_code: '0202', cost_center_code: ' ' }]).rows)
            .toEqual([{ company_code: '02', branch_code: '0202', cost_center_code: null }]);
        expect(normalizeScope(Array.from({ length: 51 }, (_, i) => ({ company_code: '02', branch_code: String(i) }))).error).toMatch(/50/);
    });

    test('escopo: sem loja repetida e sem misturar filial inteira com centro de custo dela', () => {
        const whole = { company_code: '02', branch_code: '0202' };
        expect(normalizeScope([whole, { ...whole }]).error).toMatch(/repetida/);
        expect(normalizeScope([whole, { ...whole, cost_center_code: '101' }]).error).toMatch(/inteira/);
        expect(normalizeScope([{ ...whole, cost_center_code: '101' }, { ...whole, cost_center_code: '102' }]).rows).toHaveLength(2);
    });

    test('nomes do Protheus: código sem nome é recusado', () => {
        const row = { company_code: '02', company_name: 'Frugal', branch_code: '0202', branch_name: 'Centro', cost_center_code: null };
        expect(scopeNameError([row])).toBeNull();
        expect(scopeNameError([{ ...row, company_name: null }])).toMatch(/Empresa 02/);
        expect(scopeNameError([{ ...row, branch_name: null }])).toMatch(/Filial 0202/);
        expect(scopeNameError([{ ...row, cost_center_code: '101', cost_center_name: null }])).toMatch(/Centro de custo 101/);
    });

    test('filtros e active_ids: vazio = todos; com lista = sem repetição', () => {
        expect(normalizeOpenAudit({ ...BODY, active_ids: [] }, NOW).value).toMatchObject({
            filters: { id_active_class_fk: null, active_type_id_fk: null }, active_ids: null, deadline: null,
        });
        expect(normalizeOpenAudit({ ...BODY, id_active_class_fk: '7', active_ids: [5, '5', 6] }, NOW).value)
            .toMatchObject({ filters: { id_active_class_fk: 7 }, active_ids: [5, 6] });
        expect(normalizeOpenAudit({ ...BODY, id_active_class_fk: 'x' }, NOW).error).toMatch(/id_active_class_fk/);
        expect(normalizeOpenAudit({ ...BODY, active_ids: 'abc' }, NOW).error).toBeDefined();
    });

    test('prazo vencido só em aberta/em andamento; DATE do mysql2 vira AAAA-MM-DD', () => {
        expect(dateKey(new Date(2026, 10, 20))).toBe('2026-11-20');
        expect(isOverdue({ status_audit: 1, date_deadline: '2026-11-23' }, NOW)).toBe(true);
        expect(isOverdue({ status_audit: 1, date_deadline: '2026-11-24' }, NOW)).toBe(false);
        expect(isOverdue({ status_audit: 2, date_deadline: '2026-11-01' }, NOW)).toBe(false);
        expect(isOverdue({ status_audit: 0, date_deadline: null }, NOW)).toBe(false);
    });
});
