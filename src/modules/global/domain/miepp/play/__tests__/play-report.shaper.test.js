/**
 * @fileoverview Testes do shaper dos relatórios de exibição.
 *
 * O driver devolve `SUM()` sobre BIGINT como STRING e `COUNT()` como number;
 * estes testes fixam que a resposta nunca mistura os dois.
 */

const {
    shapeMediaRow,
    shapeLocationRow,
    shapePlayerRow,
    shapeDayRow,
    shapeTotals,
    toLocationId,
    toDateKey,
} = require('../play-report.shaper');

describe('normalização de tipos', () => {
    it('converte as somas que vêm como string do driver', () => {
        const row = shapeMediaRow({
            media_id: '5',
            plays: '120',
            completed_plays: '96',
            duration_ms: '1440000',
            players: 4,
            locations: 2,
        });

        expect(row.media_id).toBe(5);
        expect(row.plays).toBe(120);
        expect(row.completed_plays).toBe(96);
        // Tempo em tela sai em SEGUNDOS: ninguém lê audiência em milissegundo.
        expect(row.seconds_on_screen).toBe(1440);
    });

    it('nunca expõe o sentinela 0 de "sem local"', () => {
        expect(toLocationId(0)).toBeNull();
        expect(toLocationId('0')).toBeNull();
        expect(toLocationId(7)).toBe(7);
        expect(shapeLocationRow({ location_id: 0, plays: 3 }).location_id).toBeNull();
    });

    it('entrega play_date como YYYY-MM-DD, sem deslocar o dia', () => {
        // A coluna é DATE e chega como Date à meia-noite local; serializada
        // direto em JSON viraria o dia anterior no fuso daqui.
        expect(shapeDayRow({ play_date: new Date(2026, 8, 21), plays: 1 }).play_date)
            .toBe('2026-09-21');
        expect(toDateKey('2026-09-21 00:00:00')).toBe('2026-09-21');
        expect(toDateKey(null)).toBeNull();
    });
});

describe('completion_rate', () => {
    it('é a proporção do que terminou', () => {
        expect(shapeMediaRow({ plays: 4, completed_plays: 3 }).completion_rate).toBe(0.75);
    });

    it('é null sem exibição — 0% e "não houve" são coisas diferentes', () => {
        expect(shapeMediaRow({ plays: 0, completed_plays: 0 }).completion_rate).toBeNull();
    });
});

describe('título da mídia', () => {
    it('prefere o título atual quando a mídia ainda existe', () => {
        const row = shapeMediaRow({
            media_id: 5,
            media_uuid: 'uuid-5',
            current_title: 'Campanha Setembro (renomeada)',
            media_title: 'Campanha Setembro',
        });

        expect(row.title).toBe('Campanha Setembro (renomeada)');
        expect(row.media_exists).toBe(true);
    });

    it('cai no snapshot quando a mídia foi apagada, e marca a linha', () => {
        // O DELETE de mídia é FÍSICO. Sem o snapshot, o relatório da campanha
        // encerrada — que é justamente o que se consulta depois — viria com a
        // linha em branco.
        const row = shapeMediaRow({
            media_id: 5,
            media_uuid: null,
            current_title: null,
            media_title: 'Campanha Agosto',
        });

        expect(row.title).toBe('Campanha Agosto');
        expect(row.media_exists).toBe(false);
    });
});

describe('recorte por tela', () => {
    it('carrega o local em que a tela estava, não o cadastro atual', () => {
        const row = shapePlayerRow({
            player_id: 8,
            player_name: 'Tela Caixa 1',
            location_id: 3,
            location_name: 'Loja Centro',
            plays: '10',
        });

        expect(row).toMatchObject({
            player_id: 8,
            player_name: 'Tela Caixa 1',
            location_id: 3,
            location_name: 'Loja Centro',
            plays: 10,
        });
    });
});

describe('shapeTotals', () => {
    it('zera tudo quando não houve exibição no período', () => {
        expect(shapeTotals(null)).toMatchObject({
            plays: 0,
            completed_plays: 0,
            completion_rate: null,
            seconds_on_screen: 0,
            players: 0,
            locations: 0,
            first_play_at: null,
            last_play_at: null,
        });
    });
});
