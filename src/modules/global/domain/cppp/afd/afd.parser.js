/**
 * @fileoverview Parse posicional do AFD da Portaria 671/2021, como o REP-C
 * Control iD o entrega.
 *
 * Puro. Porta o `controlid_etl/parser.py` e acrescenta o que só apareceu no AFD
 * INTEGRAL de 08/10/2026 (o de 28/08 era filtrado por data e não mostrava):
 *
 * | Linha                          | Exemplo / forma                               | Vira       |
 * |--------------------------------|-----------------------------------------------|------------|
 * | registro (tipos 2 a 6)         | `000021237 3 2026-07-31T06:00:00-0300 ...`    | `records`  |
 * | cabeçalho tipo 1 (NSR zero)    | `000000000 1 1 60479680001252 ...` — no FIM   | `header`   |
 * | trailer tipo 9                 | `999999999` + 6 contagens de 9 dígitos + `9`  | `trailer`  |
 * | assinatura digital             | base64, uma linha só                          | `signature`|
 * | rodapé com o nome do arquivo   | `AFD0001400375038456360479680001252REP_C.txt` | `footer`   |
 *
 * O documento de origem dizia "não há cabeçalho, toda coleta tem 1 linha não
 * reconhecida (o rodapé)". Vale para o AFD filtrado por data; o integral traz
 * as quatro. Reconhecer cada uma pelo formato faz `unknown` voltar a significar
 * o que deveria: linha que pode ser registro perdido.
 *
 * Os espaços nos exemplos acima são só para leitura — o arquivo não tem
 * separador.
 *
 * @module modules/global/domain/cppp/afd/afd.parser
 */

/** NSR(9) TIPO(1) TIMESTAMP(24) PAYLOAD(resto). Tipos aceitos: 2 a 6. */
const RECORD_RE = /^(\d{9})([2-6])(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{4})(.*)$/;

/** Cabeçalho: NSR zerado e tipo 1. */
const HEADER_RE = /^0{9}1/;

/** Trailer: `999999999`, contagens dos tipos 2, 3, 4, 5, 6 e 7, e o tipo `9`. */
const TRAILER_RE = /^9{9}(\d{9})(\d{9})(\d{9})(\d{9})(\d{9})(\d{9})9$/;

/** Rodapé: `AFD` + número do REP (17 dígitos) + CNPJ/CPF + sufixo `.txt`. */
const FOOTER_RE = /^AFD(\d{17})(\d*)(.*)\.txt$/i;

/** Assinatura: base64 numa linha só. O tamanho mínimo evita casar lixo curto. */
const SIGNATURE_RE = /^[A-Za-z0-9+/]{40,}={0,2}$/;

/**
 * @typedef {object} AfdRecord
 * @property {number}      nsr
 * @property {number}      recordType    - 2 a 6.
 * @property {string}      occurredAt    - `YYYY-MM-DD HH:MM:SS`, hora de parede do relógio.
 * @property {string}      utcOffset     - `-0300`, como veio.
 * @property {string|null} cpf           - 11 dígitos (tipos 3 e 5).
 * @property {string|null} operation     - `I`/`A`/`E` (tipo 5).
 * @property {string|null} eventCode     - 2 caracteres (tipo 6).
 * @property {string|null} employeeName  - até 52 posições (tipo 5).
 * @property {string|null} crc           - últimos 4 caracteres do payload.
 * @property {string}      payload
 * @property {string}      rawLine       - a linha sem CR/LF.
 */

/**
 * CPF a partir do campo de 12 posições do AFD 671: usa os 11 últimos dígitos.
 *
 * @param {string} value
 * @returns {string|null}
 */
function cpfFrom12(value) {
    const digits = String(value).replace(/\D/g, '');
    return digits.length === 12 ? digits.slice(-11) : null;
}

/**
 * Confere que data e hora existem no calendário. O `strptime` do Python fazia
 * isso de graça; aqui `2026-02-30` passaria pela regex.
 */
function isRealTimestamp(year, month, day, hour, minute, second) {
    const y = Number(year); const mo = Number(month); const d = Number(day);
    if (mo < 1 || mo > 12 || d < 1) return false;
    if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
    const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return d <= daysInMonth;
}

/**
 * Faz o parse de uma linha de REGISTRO (tipos 2 a 6).
 *
 * @param {string} rawLine
 * @returns {AfdRecord|null} `null` quando a linha não é registro.
 */
function parseRecordLine(rawLine) {
    const line = String(rawLine).replace(/﻿/g, '').trim();
    const match = RECORD_RE.exec(line);
    if (!match) return null;

    const [, nsr, type, year, month, day, hour, minute, second, offset, payload] = match;
    if (!isRealTimestamp(year, month, day, hour, minute, second)) return null;

    const recordType = Number(type);
    let cpf = null;
    let operation = null;
    let eventCode = null;
    let employeeName = null;
    const crc = payload.length >= 4 ? payload.slice(-4) : null;

    if (recordType === 3 && payload.length >= 12) {
        cpf = cpfFrom12(payload.slice(0, 12));
    } else if (recordType === 5 && payload.length >= 13) {
        operation = ['I', 'A', 'E'].includes(payload[0]) ? payload[0] : null;
        cpf = cpfFrom12(payload.slice(1, 13));
        // No AFD 671 do REP-C, o nome ocupa as 52 posições seguintes.
        employeeName = payload.slice(13, 65).trim() || null;
    } else if (recordType === 6 && payload.length >= 2) {
        eventCode = payload.slice(0, 2);
    }

    return {
        nsr: Number(nsr),
        recordType,
        occurredAt: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
        utcOffset: offset,
        cpf,
        operation,
        eventCode,
        employeeName,
        crc,
        payload,
        rawLine: line,
    };
}

/**
 * Lê as contagens do trailer tipo 9.
 *
 * @param {string} line
 * @returns {{2:number,3:number,4:number,5:number,6:number,7:number}|null}
 */
function parseTrailer(line) {
    const match = TRAILER_RE.exec(line);
    if (!match) return null;
    const [, t2, t3, t4, t5, t6, t7] = match.map(Number);
    return { 2: t2, 3: t3, 4: t4, 5: t5, 6: t6, 7: t7 };
}

/**
 * Classifica e faz o parse do AFD inteiro.
 *
 * @param {string} text - conteúdo já decodificado.
 * @returns {{
 *   records: AfdRecord[],
 *   header: string|null,
 *   trailer: object|null,
 *   signature: string|null,
 *   footer: {line: string, repNumber: string}|null,
 *   unknown: string[],
 * }}
 */
function parseAfd(text) {
    const result = {
        records: [],
        header: null,
        trailer: null,
        signature: null,
        footer: null,
        unknown: [],
    };

    for (const raw of String(text).split(/\r\n|\n|\r/)) {
        const line = raw.replace(/﻿/g, '').trim();
        if (!line) continue;

        const record = parseRecordLine(line);
        if (record) {
            result.records.push(record);
            continue;
        }

        // A ordem importa: o trailer começa com nove 9 e o cabeçalho com nove
        // 0 — nenhum dos dois casa com a regex de registro (tipo 9 e tipo 1
        // estão fora de [2-6]), mas os dois casariam com "só dígitos".
        if (!result.trailer) {
            const trailer = parseTrailer(line);
            if (trailer) { result.trailer = trailer; continue; }
        }
        if (!result.header && HEADER_RE.test(line)) { result.header = line; continue; }

        const footer = FOOTER_RE.exec(line);
        if (!result.footer && footer) {
            result.footer = { line, repNumber: footer[1] };
            continue;
        }

        if (!result.signature && SIGNATURE_RE.test(line)) { result.signature = line; continue; }

        result.unknown.push(line);
    }

    return result;
}

/**
 * Decodifica o corpo da resposta sem estragar o que o relógio mandou.
 *
 * Tenta UTF-8 estrito e cai para latin1 se houver sequência inválida — nome
 * acentuado em ISO-8859-1 viraria `�` com UTF-8 frouxo. O bruto gravado em
 * disco é sempre o `Buffer`, nunca este texto.
 *
 * @param {Buffer} buffer
 * @returns {string}
 */
function decodeAfd(buffer) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        return Buffer.from(buffer).toString('latin1');
    }
}

module.exports = { parseAfd, parseRecordLine, parseTrailer, decodeAfd, cpfFrom12 };
