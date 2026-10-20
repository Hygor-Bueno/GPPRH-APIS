/**
 * @fileoverview Worker da coleta do relógio de ponto (CPPP).
 *
 * É o ÚNICO processo que fala com o relógio Control iD. A cada
 * `CPPP_QUEUE_POLL_SECONDS` (padrão 15s), num ciclo:
 *
 *   1. marca como `failed` coleta `running` abandonada (worker morto no meio);
 *   2. enfileira a coleta diária de cada relógio, se o horário
 *      `CPPP_COLLECT_TIME` (padrão 02:00) já passou e a de hoje não existe;
 *   3. executa o que estiver na fila — a diária e as disparadas pela tela.
 *
 * ─── Por que processo próprio ────────────────────────────────────────────────
 * Mesmo motivo do `miepp-grid-renderer`: a API roda em cluster de 2, e um laço
 * ali rodaria duas vezes. Aqui é app PM2 com `instances: 1` no MESMO container
 * do backend interno (`ecosystem.docker.config.js`) — não precisa de imagem
 * nova: só HTTP para o relógio e MySQL.
 *
 * ─── A trava, mesmo com uma instância ────────────────────────────────────────
 * `GET_LOCK` é o cinto a mais caso alguém suba `instances` ou rode o worker à
 * mão com o do container de pé. O banco já impede duas coletas vivas do mesmo
 * relógio (`uq_cppp_runs_active`) e a execução só começa se o `claim` vencer —
 * a trava evita o trabalho dobrado de chegar até lá.
 *
 * ⚠️ Rede: o container precisa alcançar o IP de CADA relógio cadastrado. O
 *    botão "testar conexão" do cadastro (`POST /cppp/devices/:id/test-connection`)
 *    roda do mesmo container e responde isso.
 *
 * Sessão: cada coleta faz login → AFD → logout, com conexão própria. Nenhuma
 * sessão do relógio sobrevive entre coletas — o login expira.
 *
 * Uso: `node src/workers/cppp-afd-collector.js`
 *
 * @module workers/cppp-afd-collector
 */

'use strict';

require('dotenv').config();

const { poolGlobal } = require('../config/mysql');
const { cpppConfig } = require('../config/cppp');

const { CpppCollectUseCases } = require('../modules/global/application/cppp/collect/cppp-collect.use-cases');
const { COLLECT_TIME_RE } = require('../modules/global/domain/cppp/collect/collect-schedule.rules');
const { MysqlCpppAfdRepository } = require('../modules/global/infrastructure/cppp/mysql-cppp-afd.repository');
const {
    MysqlCpppCollectRunRepository,
    MysqlCpppDeviceRepository,
} = require('../modules/global/infrastructure/cppp/mysql-cppp-collect.repository');
const { ControlIdClockClient } = require('../modules/global/infrastructure/cppp/controlid-clock.client');
const { FsCpppRawAfdStorage } = require('../modules/global/infrastructure/cppp/fs-cppp-raw-afd.storage');

const LOCK_NAME = 'cppp_afd_collector';
const LOCK_TIMEOUT_SECONDS = 0;

if (!COLLECT_TIME_RE.test(cpppConfig.collectTime)) {
    // Falhar no boot, e não em todo ciclo: com o horário inválido a coleta
    // diária nunca aconteceria, e o log de erro a cada 15s esconderia isso.
    console.error(`[cppp] CPPP_COLLECT_TIME inválido: '${cpppConfig.collectTime}' (use HH:MM). Worker não iniciado.`);
    process.exit(1);
}

let shuttingDown = false;
let timer = null;

const useCases = new CpppCollectUseCases({
    runs: new MysqlCpppCollectRunRepository(),
    devices: new MysqlCpppDeviceRepository(),
    afd: new MysqlCpppAfdRepository(),
    clock: new ControlIdClockClient({ config: cpppConfig }),
    rawStorage: new FsCpppRawAfdStorage({ root: cpppConfig.storageRoot }),
    config: cpppConfig,
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
            console.warn('[cppp] outro processo está coletando; pulando este ciclo.');
            return;
        }

        try {
            const { stuck, scheduled, executed } = await useCases.runCycle();

            // Ciclo vazio é o normal (a coleta é diária). Logar só quando algo
            // aconteceu mantém o log legível.
            if (stuck) console.warn(`[cppp] ${stuck} coleta(s) abandonada(s) marcada(s) como failed.`);
            if (scheduled) console.log(`[cppp] ${scheduled} coleta(s) diária(s) enfileirada(s).`);
            for (const run of executed) {
                const line = `[cppp] coleta #${run.id}: ${run.status}, ${run.inserted} registro(s) novo(s)`;
                if (run.status === 'failed') console.error(`${line} — ${run.error ?? 'ver cppp_collect_runs.error'}`);
                else console.log(line);
            }
        } finally {
            await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
        }
    } finally {
        conn.release();
    }
}

/** `setTimeout` encadeado: uma coleta integral de 180s nunca se sobrepõe à próxima. */
function scheduleNext() {
    if (shuttingDown) return;
    timer = setTimeout(async () => {
        try {
            await runOnce();
        } catch (error) {
            // Nunca derruba o worker: MySQL ou relógio fora do ar se resolvem
            // sozinhos, e a coleta é recuperada no ciclo seguinte.
            console.error('[cppp] ciclo falhou:', error.message);
        } finally {
            scheduleNext();
        }
    }, cpppConfig.queuePollMs);
}

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[cppp] ${signal} recebido, encerrando.`);
    if (timer) clearTimeout(timer);
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(
    `[cppp] worker iniciado — coleta diária às ${cpppConfig.collectTime}, fila a cada ${cpppConfig.queuePollMs / 1000}s, ` +
    `TLS ${cpppConfig.verifyTls ? 'verificado' : 'SEM verificação (certificado autoassinado)'}, AFD bruto em ${cpppConfig.storageRoot}.`
);

runOnce()
    .catch((error) => console.error('[cppp] primeiro ciclo falhou:', error.message))
    .finally(scheduleNext);

module.exports = { runOnce, LOCK_NAME };
