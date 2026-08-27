const { normalizeBirthDate } = require('../meal-enroll.use-cases');

describe('normalizeBirthDate', () => {
    it('aceita YYYYMMDD, o formato do RA_NASC', () => {
        expect(normalizeBirthDate('19850312')).toBe('19850312');
    });

    it('aceita DDMMYYYY, como a pessoa digita', () => {
        expect(normalizeBirthDate('12031985')).toBe('19850312');
    });

    it('ignora separadores', () => {
        expect(normalizeBirthDate('12/03/1985')).toBe('19850312');
        expect(normalizeBirthDate('1985-03-12')).toBe('19850312');
        expect(normalizeBirthDate(' 12 03 1985 ')).toBe('19850312');
    });

    /**
     * O caso que a heurística ingênua errava: '3112' nos quatro primeiros dígitos
     * é maior que 1900, então comparar com 1900 leria ano 3112 e reprovaria a
     * pessoa três vezes até queimar o convite dela.
     */
    it('acerta aniversario de 31 de dezembro', () => {
        expect(normalizeBirthDate('31121985')).toBe('19851231');
    });

    it('acerta todo dia de 19 a 31, que e onde a heuristica ingenua quebrava', () => {
        for (let day = 19; day <= 28; day += 1) {
            const dd = String(day).padStart(2, '0');
            expect(normalizeBirthDate(`${dd}071990`)).toBe(`1990 07 ${dd}`.replace(/ /g, ''));
        }
    });

    it('acerta 20 de dezembro', () => {
        expect(normalizeBirthDate('20121990')).toBe('19901220');
    });

    it('recusa data impossivel', () => {
        expect(normalizeBirthDate('31021985')).toBeNull();   // 31 de fevereiro
        expect(normalizeBirthDate('19850230')).toBeNull();   // 30 de fevereiro
        expect(normalizeBirthDate('19851345')).toBeNull();   // mes 13, dia 45
    });

    it('recusa ano fora da faixa de nascimento', () => {
        expect(normalizeBirthDate('18991231')).toBeNull();
        expect(normalizeBirthDate('99991231')).toBeNull();
    });

    it('recusa tamanho errado', () => {
        expect(normalizeBirthDate('1985031')).toBeNull();
        expect(normalizeBirthDate('198503121')).toBeNull();
        expect(normalizeBirthDate('')).toBeNull();
        expect(normalizeBirthDate(null)).toBeNull();
        expect(normalizeBirthDate(undefined)).toBeNull();
    });

    it('recusa texto', () => {
        expect(normalizeBirthDate('nao sei')).toBeNull();
    });

    // Ida e volta em todas as datas de um ano bissexto: se alguma ordem for
    // ambigua, aparece aqui e nao em producao.
    it('faz ida e volta em todo dia de 1988', () => {
        for (let month = 1; month <= 12; month += 1) {
            const daysInMonth = new Date(Date.UTC(1988, month, 0)).getUTCDate();

            for (let day = 1; day <= daysInMonth; day += 1) {
                const mm = String(month).padStart(2, '0');
                const dd = String(day).padStart(2, '0');
                const iso = `1988${mm}${dd}`;

                expect(normalizeBirthDate(iso)).toBe(iso);
                expect(normalizeBirthDate(`${dd}${mm}1988`)).toBe(iso);
            }
        }
    });
});
