/**
 * @fileoverview Worker do renderizador de grade de produtos.
 *
 * ─── Por que processo próprio, e não dentro da API ───────────────────────────
 *
 * O backend interno roda `pm2-runtime` em cluster com 2 instâncias. Um laço de
 * cadência dentro dele rodaria DUAS vezes: duas consultas ao Consinco por
 * ciclo, dois Chromium abertos ao mesmo tempo e duas gravações concorrentes na
 * mesma grade. É o mesmo motivo que pôs o transcodificador de vídeo num
 * processo separado, e o mesmo que descartou o job varredor de players.
 *
 * Aqui ele é um app PM2 próprio com `instances: 1` (ver
 * `ecosystem.docker.config.js`), no MESMO container — a imagem já tem o
 * Chromium do Puppeteer, então não é preciso container novo.
 *
 * ─── A trava, mesmo com uma instância ────────────────────────────────────────
 *
 * `GET_LOCK` do MySQL é um cinto a mais, não a defesa principal. Existe porque
 * `instances: 1` é configuração, e configuração muda: alguém sobe para 2 para
 * "acelerar", ou roda o worker à mão para testar enquanto o do container está
 * de pé. Sem a trava, o sintoma seria a mesma grade renderizada duas vezes com
 * checksums diferentes, e as telas rebaixando em loop.
 *
 * Uso: `node src/workers/miepp-grid-renderer.js`
 *
 * @module workers/miepp-grid-renderer
 */

'use strict';

require('dotenv').config();

const { poolGlobal } = require('../config/mysql');
const { mieppConfig } = require('../config/miepp');

const { MieppGridRenderUseCases } = require('../modules/global/application/miepp/product-grid/miepp-grid-render.use-cases');
const { MysqlMieppProductGridRepository } = require('../modules/global/infrastructure/miepp/mysql-miepp-product-grid.repository');
const { MieppGridRendererService } = require('../modules/global/infrastructure/miepp/miepp-grid-renderer.service');
const { mediaStorage } = require('../modules/global/infrastructure/miepp/miepp-services');
const { findActiveProductsByPlus } = require('../modules/global/repositories/oracle/miepp-product-grid.oracle.queries');

/** Nome da trava no MySQL. Global ao servidor — por isso carrega o módulo. */
const LOCK_NAME = 'miepp_grid_renderer';

/**
 * Espera zero no `GET_LOCK`: se outro processo está no ciclo, este pula e tenta
 * de novo no próximo intervalo. Enfileirar seria pior — as duas instâncias
 * acabariam alternando ciclos em vez de uma ficar de fora.
 */
const LOCK_TIMEOUT_SECONDS = 0;

let shuttingDown = false;
let timer = null;

const useCases = new MieppGridRenderUseCases({
    repository: new MysqlMieppProductGridRepository(),
    productSource: { findActiveProductsByPlus },
    renderer: new MieppGridRendererService({
        width: mieppConfig.gridRenderWidth,
        height: mieppConfig.gridRenderHeight,
    }),
    storage: mediaStorage,
});

/**
 * Roda um ciclo segurando a trava.
 *
 * A conexão é a MESMA do `GET_LOCK` ao `RELEASE_LOCK` de propósito: a trava do
 * MySQL pertence à sessão, e pedir outra conexão do pool no meio soltaria a
 * trava sem querer (ou tentaria liberar uma que aquela sessão não tem).
 */
async function runOnce() {
    const conn = await poolGlobal.getConnection();

    try {
        const [[lock]] = await conn.query('SELECT GET_LOCK(?, ?) AS ok', [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);

        if (Number(lock.ok) !== 1) {
            console.warn('[miepp-grid] outro processo está renderizando; pulando este ciclo.');
            return;
        }

        try {
            const tally = await useCases.runCycle(mieppConfig.gridRenderBatch);

            // Ciclo sem nada a fazer é o caso comum (preço não muda de 5 em 5
            // minutos). Logar só quando algo aconteceu mantém o log legível.
            if (tally.rendered || tally.off_air || tally.failed) {
                console.log('[miepp-grid] ciclo:', JSON.stringify(tally));
            }
        } finally {
            await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
        }
    } finally {
        conn.release();
    }
}

/**
 * Agenda o próximo ciclo DEPOIS que o atual termina.
 *
 * `setTimeout` encadeado e não `setInterval`: com intervalo fixo, um ciclo mais
 * lento que o intervalo faria os ciclos se sobreporem, e dois Chromium abertos
 * ao mesmo tempo no container é exatamente o que o `mem_limit` não comporta.
 */
function scheduleNext() {
    if (shuttingDown) return;
    timer = setTimeout(async () => {
        try {
            await runOnce();
        } catch (error) {
            // Nunca derruba o worker: uma falha de infraestrutura precisa ser
            // recuperável sozinha quando o Oracle ou o MySQL voltarem.
            console.error('[miepp-grid] ciclo falhou:', error.message);
        } finally {
            scheduleNext();
        }
    }, mieppConfig.gridRenderIntervalMs);
}

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[miepp-grid] ${signal} recebido, encerrando.`);
    if (timer) clearTimeout(timer);
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(
    `[miepp-grid] worker iniciado — ciclo a cada ${mieppConfig.gridRenderIntervalMs / 1000}s, ` +
    `lote de ${mieppConfig.gridRenderBatch}, ${mieppConfig.gridRenderWidth}x${mieppConfig.gridRenderHeight}.`
);

// Primeiro ciclo imediato: subir o worker e esperar 5 minutos para saber se ele
// funciona torna qualquer diagnóstico insuportável.
runOnce()
    .catch(error => console.error('[miepp-grid] primeiro ciclo falhou:', error.message))
    .finally(scheduleNext);

module.exports = { runOnce, LOCK_NAME };
