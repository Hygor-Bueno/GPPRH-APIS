/**
 * @fileoverview Aritmética de datas `YYYY-MM-DD` sem fuso.
 *
 * Puro. Toda data de calendário da suite circula como texto `YYYY-MM-DD` — o
 * dia do relógio de ponto é a hora de PAREDE do equipamento, e passar por
 * `Date` local reintroduziria o deslocamento de 3h que já quebrou o chat e o
 * GTPP (ver `mysql-datetime.sql.js`). As contas usam `Date.UTC` só como
 * calculadora: nunca saem daqui como instante.
 *
 * @module modules/global/domain/cppp/date.rules
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @param {string} value @returns {boolean} */
function isDate(value) {
    const match = DATE_RE.exec(String(value ?? ''));
    if (!match) return false;
    const [, y, m, d] = match.map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** @param {string} date @param {number} days @returns {string} */
function addDays(date, days) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Dias corridos de `from` a `to`, contando os dois. */
function spanDays(from, to) {
    const [y1, m1, d1] = from.split('-').map(Number);
    const [y2, m2, d2] = to.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

/** @returns {string[]} cada dia de `from` a `to`, inclusive. */
function eachDay(from, to) {
    const days = [];
    for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
    return days;
}

const minDate = (...dates) => dates.filter(Boolean).sort()[0] ?? null;
const maxDate = (...dates) => dates.filter(Boolean).sort().pop() ?? null;

/**
 * Data local do processo. O container roda com `TZ=America/Sao_Paulo`, o mesmo
 * fuso do relógio, então "hoje" aqui é o "hoje" do equipamento.
 *
 * @param {Date} now
 * @returns {string}
 */
function localDate(now) {
    return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
    ].join('-');
}

/** `YYYY-MM-DDTHH:MM:SS` local — mesmo formato do `localDateTime()` do MySQL. */
function localDateTime(now) {
    return `${localDate(now)}T${[now.getHours(), now.getMinutes(), now.getSeconds()]
        .map((part) => String(part).padStart(2, '0')).join(':')}`;
}

module.exports = { isDate, addDays, spanDays, eachDay, minDate, maxDate, localDate, localDateTime };
