/**
 * @fileoverview Janela de fechamento dos recibos pelo RH.
 *
 * Toda segunda-feira, das 12:00 até o fim do dia, o RH fecha os recibos de
 * compra de folga. Nesse intervalo ninguém lança, edita nem aprova folga, nem
 * quem tem permissão de gestão: uma jornada que entra na fila do RH no meio do
 * fechamento fica fora do lote ou chega com o valor alterado. Na terça, à
 * 00:00, tudo volta ao normal.
 *
 * O que continua liberado na janela: as consultas, o fechamento do próprio RH
 * (`POST /payments` e `/payments/close`) e o desconsiderar (`PATCH
 * /time-records/discard`), que é a via de estorno do RH antes do recibo.
 *
 * A hora é lida em `America/Sao_Paulo` explicitamente, sem depender do `TZ` do
 * processo: um container sem a variável erraria a janela em 3 horas.
 *
 * @module modules/gipp/domain/payroll-closing-window.rules
 */

const { AppError } = require('../../../errors/app.error');

const PAYROLL_CLOSING_WINDOW = Object.freeze({
    timeZone: 'America/Sao_Paulo',
    /** Dia da semana, como `Intl` devolve em `en-US` com `weekday: 'short'`. */
    weekday: 'Mon',
    /** Hora local em que o bloqueio começa; termina na virada do dia. */
    startHour: 12,
});

const localParts = new Intl.DateTimeFormat('en-US', {
    timeZone: PAYROLL_CLOSING_WINDOW.timeZone,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
});

/**
 * @param {Date} now
 * @returns {boolean} true de segunda 12:00 até segunda 23:59:59, hora de Brasília.
 */
function isPayrollClosingWindow(now) {
    const parts = Object.fromEntries(localParts.formatToParts(now).map(p => [p.type, p.value]));
    return parts.weekday === PAYROLL_CLOSING_WINDOW.weekday
        && Number(parts.hour) >= PAYROLL_CLOSING_WINDOW.startHour;
}

/**
 * @param {Date} now
 * @throws {AppError} 423 `PAYROLL_CLOSING` dentro da janela de fechamento.
 */
function assertOutsidePayrollClosing(now) {
    if (!isPayrollClosingWindow(now)) return;

    throw new AppError(
        'O RH está fechando os recibos: segunda-feira a partir das 12h não é possível lançar nem aprovar folgas. O lançamento volta na terça-feira.',
        423,
        { code: 'PAYROLL_CLOSING' },
    );
}

module.exports = { PAYROLL_CLOSING_WINDOW, isPayrollClosingWindow, assertOutsidePayrollClosing };
