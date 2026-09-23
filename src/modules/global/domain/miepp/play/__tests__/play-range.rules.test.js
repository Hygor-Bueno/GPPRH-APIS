/**
 * @fileoverview Testes da janela de datas dos relatórios.
 */

const { normalizeRange, MAX_RANGE_DAYS, DEFAULT_RANGE_DAYS } = require('../play-range.rules');

const HOJE = new Date(2026, 8, 21);

describe('normalizeRange', () => {
    it('sem filtro, usa os últimos 30 dias terminando hoje', () => {
        expect(normalizeRange({}, HOJE)).toEqual({
            from: '2026-08-23',
            to: '2026-09-21',
            days: DEFAULT_RANGE_DAYS,
        });
    });

    it('respeita a janela pedida', () => {
        expect(normalizeRange({ from: '2026-09-01', to: '2026-09-07' }, HOJE))
            .toEqual({ from: '2026-09-01', to: '2026-09-07', days: 7 });
    });

    it('um dia só é uma janela válida de 1 dia', () => {
        expect(normalizeRange({ from: '2026-09-21', to: '2026-09-21' }, HOJE).days).toBe(1);
    });

    it('desinverte as pontas em vez de devolver zero linhas', () => {
        // O operador trocou os campos. Manter a inversão entregaria relatório
        // vazio sem explicação nenhuma na tela.
        expect(normalizeRange({ from: '2026-09-07', to: '2026-09-01' }, HOJE))
            .toEqual({ from: '2026-09-01', to: '2026-09-07', days: 7 });
    });

    it('encurta janela acima do teto pelo INÍCIO, e diz qual usou', () => {
        const range = normalizeRange({ from: '2015-01-01', to: '2026-09-21' }, HOJE);

        expect(range.days).toBe(MAX_RANGE_DAYS);
        expect(range.to).toBe('2026-09-21');
        // O fim é o que interessa a quem olha "até agora"; e como a janela
        // efetiva volta na resposta, o encurtamento não é silencioso.
        expect(range.from).toBe('2025-09-21');
    });

    it('cai no padrão quando a data é malformada', () => {
        expect(normalizeRange({ from: '01/09/2026' }, HOJE).from).toBe('2026-08-23');
        expect(normalizeRange({ from: '2026-9-1' }, HOJE).from).toBe('2026-08-23');
    });

    it('recusa data que não existe no calendário', () => {
        // `new Date(2026, 1, 31)` viraria 3 de março, e o relatório sairia de um
        // período que ninguém pediu.
        expect(normalizeRange({ from: '2026-02-31', to: '2026-09-21' }, HOJE).from)
            .toBe('2026-08-23');
    });

    it('aceita 29 de fevereiro em ano bissexto', () => {
        expect(normalizeRange({ from: '2028-02-29', to: '2028-03-01' }, HOJE).from)
            .toBe('2028-02-29');
    });
});
