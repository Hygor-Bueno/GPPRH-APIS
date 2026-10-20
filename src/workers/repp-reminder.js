/**
 * @fileoverview Worker dos lembretes da REPP (reserva de espaços).
 *
 * A cada `REPP_REMINDER_POLL_SECONDS` (padrão 30s) procura reservas
 * aprovadas cujo horário do lembrete já chegou e avisa o criador: grava em
 * `re_notifications` e manda o `repp:event` pelo WebSocket
 * (`application/repp/reminder`). O atraso máximo de um lembrete é o
 * intervalo do ciclo.
 *
 * ─── Por que processo próprio ────────────────────────────────────────────────
 * Mesmo motivo do `cppp-afd-collector`: a API roda em cluster de 2, e um laço
 * ali rodaria duas vezes. App PM2 com `instances: 1` no MESMO container do
 * backend interno (`ecosystem.docker.config.js`) — só MySQL e um POST para o
 * WebSocket (`WS_EMIT_URL`, o mesmo da API).
 *
 * ─── A trava, mesmo com uma instância ────────────────────────────────────────
 * O carimbo `reminder_sent_at` com a reserva travada já impede lembrete
 * duplicado. O `GET_LOCK` só evita o trabalho dobrado se alguém subir
 * `instances` ou rodar o worker à mão com o do container de pé.
 *
 * Uso: `node src/workers/repp-reminder.js`
 *
 * @module workers/repp-reminder
 */

'use strict';

require('dotenv').config();

const { poolGlobal } = require('../config/mysql');
const { ReppReminderUseCases } = require('../modules/global/application/repp/reminder/repp-reminder.use-cases');
const { MysqlReppReminderRepository } = require('../modules/global/infrastructure/repp/mysql-repp-reminder.repository');
const { HttpReppEventPublisher } = require('../modules/global/infrastructure/repp/http-repp-event.publisher');

const LOCK_NAME = 'repp_reminder';
const LOCK_TIMEOUT_SECONDS = 0;

const DEFAULT_POLL_SECONDS = 30;
const pollSeconds = Number(process.env.REPP_REMINDER_POLL_SECONDS) || DEFAULT_POLL_SECONDS;
const POLL_MS = Math.max(5, pollSeconds) * 1000;

let shuttingDown = false;
let timer = null;

const useCases = new ReppReminderUseCases({
    reminderRepository: new MysqlReppReminderRepository(),
    eventPublisher: new HttpReppEventPublisher(),
});

/**
 * Um ciclo segurando a trava. A conexão é a MESMA do `GET_LOCK` ao
 * `RELEASE_LOCK`: a trava do MySQL pertence à sessão.
 */
async function runOnce() {
    const conn = await poolGlobal.getConnection();

    try {
        const [[lock]] = await conn.query('SELECT GET_LOCK(?, ?) AS ok', [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);

        if (Number(lock.ok) !== 1) {
            console.warn('[repp:reminder] outro processo está enviando lembretes; pulando este ciclo.');
            return;
        }

        try {
            const { due, sent, failed } = await useCases.runCycle();
            // Ciclo vazio é o normal. Logar só quando algo aconteceu.
            if (due) console.log(`[repp:reminder] ${sent} lembrete(s) enviado(s) de ${due} vencido(s)${failed ? `, ${failed} com erro` : ''}.`);
        } finally {
            await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
        }
    } finally {
        conn.release();
    }
}

/** `setTimeout` encadeado: um ciclo lento nunca se sobrepõe ao próximo. */
function scheduleNext() {
    if (shuttingDown) return;
    timer = setTimeout(async () => {
        try {
            await runOnce();
        } catch (error) {
            // Nunca derruba o worker: MySQL fora do ar se resolve sozinho, e o
            // lembrete não carimbado sai no ciclo seguinte.
            console.error('[repp:reminder] ciclo falhou:', error.message);
        } finally {
            scheduleNext();
        }
    }, POLL_MS);
}

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[repp:reminder] ${signal} recebido, encerrando.`);
    if (timer) clearTimeout(timer);
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`[repp:reminder] worker iniciado — ciclo a cada ${POLL_MS / 1000}s.`);

runOnce()
    .catch((error) => console.error('[repp:reminder] primeiro ciclo falhou:', error.message))
    .finally(scheduleNext);

module.exports = { runOnce, LOCK_NAME };
