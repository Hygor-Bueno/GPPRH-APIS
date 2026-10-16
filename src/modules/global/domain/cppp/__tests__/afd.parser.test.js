/**
 * Parse posicional do AFD 671. As linhas são do AFD real do relógio
 * (192.168.10.28), coletado em 08/10/2026 — inclusive as quatro que não são
 * registro.
 */

const { parseAfd, parseRecordLine, parseTrailer, decodeAfd } = require('../afd/afd.parser');

const PUNCH = '0000212373' + '2026-07-31T06:00:00-0300' + '010622338908ee93';
const EVENT = '00000000162026-04-29T11:13:00-030002';
const EMPLOYEE = '00000000752026-06-05T09:50:00-0300I012834651819'
    + 'ADAO PEREIRA DE OLIVEIRA'.padEnd(52) + '1000000000000012a4c';
const CLOCK_ADJUST = '00002072842026-07-29T16:47:00-03002026-07-29T16:47:00-030041108648878eda3';
const TRAILER = '9999999990000000020000398840000000010000023690000024050000000009';
const SIGNATURE = 'a8y+9a9ffFawoinEna6xcf9Wxpe7WFxiVbg2mcxMNGVgkTnl+ZsW2BIiMRppTo0U59YqJD4RRX7kT96Ayl3puQ==            ';
const HEADER = '000000000116047968000125200000000000000INTERLAGOS - PEG PESE SUPERMERCADOS IMPORTACAO E EXPORTACAO LTDA';
const FOOTER = 'AFD0001400375038456360479680001252REP_C.txt';

describe('parseRecordLine', () => {
    test('tipo 3: CPF dos 11 últimos dígitos do campo de 12, CRC nos 4 finais', () => {
        const record = parseRecordLine(PUNCH);
        expect(record).toMatchObject({
            nsr: 21237,
            recordType: 3,
            occurredAt: '2026-07-31 06:00:00',
            utcOffset: '-0300',
            cpf: '10622338908',
            crc: 'ee93',
            rawLine: PUNCH,
        });
    });

    test('tipo 6: código do evento nas 2 primeiras posições', () => {
        const record = parseRecordLine(EVENT);
        expect(record).toMatchObject({ nsr: 1, recordType: 6, eventCode: '02', cpf: null });
    });

    test('tipo 5: operação, CPF e nome de 52 posições', () => {
        const record = parseRecordLine(EMPLOYEE);
        expect(record).toMatchObject({
            recordType: 5,
            operation: 'I',
            cpf: '12834651819',
            employeeName: 'ADAO PEREIRA DE OLIVEIRA',
        });
    });

    test('tipo 4: parse genérico, sem CPF', () => {
        const record = parseRecordLine(CLOCK_ADJUST);
        expect(record).toMatchObject({ nsr: 20728, recordType: 4, cpf: null, crc: 'eda3' });
    });

    test('CR/LF e BOM não entram na raw_line', () => {
        expect(parseRecordLine(`﻿${PUNCH}\r\n`).rawLine).toBe(PUNCH);
    });

    test('data impossível é recusada (o strptime do Python fazia isso)', () => {
        expect(parseRecordLine('0000000013' + '2026-02-30T08:00:00-0300' + '010622338908ee93')).toBeNull();
        expect(parseRecordLine('0000000013' + '2026-08-20T24:00:00-0300' + '010622338908ee93')).toBeNull();
    });

    test('tipos fora de 2–6 não são registro', () => {
        expect(parseRecordLine(HEADER)).toBeNull();
        expect(parseRecordLine(TRAILER)).toBeNull();
    });
});

describe('parseAfd', () => {
    test('AFD integral: as quatro linhas que não são registro são reconhecidas, nenhuma vira "desconhecida"', () => {
        const text = [EVENT, PUNCH, EMPLOYEE, TRAILER, SIGNATURE, HEADER, FOOTER, ''].join('\r\n');
        const result = parseAfd(text);

        expect(result.records.map((r) => r.nsr)).toEqual([1, 21237, 7]);
        expect(result.trailer).toEqual({ 2: 2, 3: 39884, 4: 1, 5: 2369, 6: 2405, 7: 0 });
        expect(result.signature).toBe(SIGNATURE.trim());
        expect(result.header).toBe(HEADER);
        expect(result.footer).toEqual({ line: FOOTER, repNumber: '00014003750384563' });
        expect(result.unknown).toEqual([]);
    });

    test('AFD filtrado por data (como o de 28/08): só o rodapé, sem cabeçalho', () => {
        const result = parseAfd([PUNCH, '', FOOTER].join('\r\n'));
        expect(result.records).toHaveLength(1);
        expect(result.header).toBeNull();
        expect(result.footer.repNumber).toBe('00014003750384563');
        expect(result.unknown).toEqual([]);
    });

    test('linha irreconhecível vai para unknown (pode ser registro perdido)', () => {
        const result = parseAfd('cabecalho\n\nlinha invalida');
        expect(result.records).toEqual([]);
        expect(result.unknown).toEqual(['cabecalho', 'linha invalida']);
    });
});

describe('parseTrailer', () => {
    test('contagens dos tipos 2 a 7', () => {
        expect(parseTrailer(TRAILER)).toEqual({ 2: 2, 3: 39884, 4: 1, 5: 2369, 6: 2405, 7: 0 });
        expect(parseTrailer('999999999123')).toBeNull();
    });
});

describe('decodeAfd', () => {
    test('UTF-8 válido é lido como UTF-8', () => {
        expect(decodeAfd(Buffer.from('JOSÉ', 'utf8'))).toBe('JOSÉ');
    });

    test('latin1 não vira caractere de substituição', () => {
        expect(decodeAfd(Buffer.from('JOSÉ', 'latin1'))).toBe('JOSÉ');
    });
});
