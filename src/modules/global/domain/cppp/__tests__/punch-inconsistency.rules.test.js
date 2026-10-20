/**
 * Porte 1:1 de `controlid_etl/tests/test_audit.py`, mais os parâmetros
 * configuráveis e a chave de ocorrência.
 */

const { analyse, summarise, findingKey } = require('../inconsistency/punch-inconsistency.rules');

const day = (cpf, date, ...times) => times.map((time) => ({ cpf, day: date, time: `${time}:00` }));

/** Histórico regular, fechando sempre às 17:00. */
function routine(cpf, days = 6) {
    const punches = [];
    for (let i = 0; i < days; i++) {
        punches.push(...day(cpf, `2026-08-${String(i + 1).padStart(2, '0')}`, '08:00', '12:00', '13:00', '17:00'));
    }
    return punches;
}

const issues = (findings) => findings.map((f) => f.issue);

describe('paridade', () => {
    test('número ímpar é apontado', () => {
        expect(issues(analyse(day('111', '2026-08-10', '08:00', '12:00', '13:00')))).toEqual(['batida_impar']);
    });

    test('batida única é ocorrência própria', () => {
        expect(issues(analyse(day('111', '2026-08-10', '08:00')))).toEqual(['batida_unica']);
    });

    test('número par fecha', () => {
        expect(analyse(day('111', '2026-08-10', '08:00', '17:00'))).toEqual([]);
    });

    test('dia típico de seis batidas, com café, fecha', () => {
        expect(analyse(day('111', '2026-08-10', '07:59', '09:02', '09:19', '12:02', '13:01', '17:12'))).toEqual([]);
    });
});

describe('duplicada', () => {
    test('leituras dentro da janela são apontadas', () => {
        const findings = analyse(day('111', '2026-08-10', '08:00', '08:02', '12:00', '17:00'));
        expect(issues(findings)).toContain('duplicada');
        expect(findings.find((f) => f.issue === 'duplicada').context).toEqual({ first: '08:00', second: '08:02', gap_minutes: 2 });
    });

    test('fora da janela não', () => {
        expect(issues(analyse(day('111', '2026-08-10', '08:00', '08:10', '12:00', '17:00')))).not.toContain('duplicada');
    });

    test('janela é configurável', () => {
        const punches = day('111', '2026-08-10', '08:00', '08:10', '12:00', '17:00');
        expect(issues(analyse(punches, { duplicateWindowMinutes: 10 }))).toContain('duplicada');
    });

    test('segundos são descartados, como no ETL', () => {
        const punches = [
            { cpf: '111', day: '2026-08-10', time: '08:00:59' },
            { cpf: '111', day: '2026-08-10', time: '08:03:00' },
        ];
        expect(issues(analyse(punches))).toContain('duplicada');
    });
});

describe('fecha_cedo', () => {
    test('dia par fechando cedo é pego', () => {
        const punches = [...routine('111'), ...day('111', '2026-08-20', '08:00', '12:00')];
        const findings = analyse(punches).filter((f) => f.day === '2026-08-20');
        expect(issues(findings)).toEqual(['fecha_cedo']);
        expect(findings[0].context).toMatchObject({ last_punch: '12:00', median_closing: '17:00', baseline_days: 7 });
        expect(findings[0].detail).toBe('última batida 12:00, mediana da pessoa 17:00');
    });

    test('dia fechando no horário passa', () => {
        const punches = [...routine('111'), ...day('111', '2026-08-20', '08:00', '17:05')];
        expect(analyse(punches).filter((f) => f.day === '2026-08-20')).toEqual([]);
    });

    test('sem histórico suficiente não opina', () => {
        const punches = [...routine('111', 2), ...day('111', '2026-08-20', '08:00', '12:00')];
        expect(analyse(punches).filter((f) => f.day === '2026-08-20')).toEqual([]);
    });

    test('a base é por pessoa: quem fecha cedo todo dia não é acusado', () => {
        const punches = [];
        for (let i = 0; i < 6; i++) punches.push(...day('222', `2026-08-0${i + 1}`, '08:00', '12:00'));
        expect(analyse(punches).filter((f) => f.cpf === '222')).toEqual([]);
    });

    test('limites configuráveis', () => {
        const punches = [...routine('111'), ...day('111', '2026-08-20', '08:00', '16:00')];
        expect(analyse(punches).filter((f) => f.day === '2026-08-20')).toEqual([]);
        expect(issues(analyse(punches, { earlyCloseMinutes: 60 }).filter((f) => f.day === '2026-08-20'))).toEqual(['fecha_cedo']);
        expect(analyse(punches, { earlyCloseMinutes: 60, minBaselineDays: 30 }).filter((f) => f.day === '2026-08-20')).toEqual([]);
    });

    test('quem sai para o almoço e não volta: 4 batidas e nenhuma saída', () => {
        const history = [];
        for (let i = 0; i < 6; i++) {
            history.push(...day('333', `2026-08-0${i + 1}`, '07:59', '09:02', '09:19', '12:02', '13:01', '17:12'));
        }
        const punches = [...history, ...day('333', '2026-08-10', '07:59', '09:02', '09:19', '12:02')];
        expect(issues(analyse(punches).filter((f) => f.day === '2026-08-10'))).toEqual(['fecha_cedo']);
    });
});

describe('resumo e chave', () => {
    test('contagem por regra', () => {
        const punches = [...day('111', '2026-08-10', '08:00'), ...day('222', '2026-08-10', '08:00')];
        expect(summarise(analyse(punches))).toEqual({ batida_unica: 2 });
    });

    test('entrada vazia', () => {
        expect(analyse([])).toEqual([]);
        expect(summarise([])).toEqual({});
    });

    test('dois pares duplicados no mesmo dia são ocorrências distintas', () => {
        const findings = analyse(day('111', '2026-08-10', '08:00', '08:01', '12:00', '12:01'));
        const keys = findings.filter((f) => f.issue === 'duplicada').map(findingKey);
        expect(new Set(keys).size).toBe(2);
    });
});
