/**
 * @fileoverview Worker de transcodificação de vídeo — processo próprio.
 *
 * Roda no container `transcoder`, fora do cluster PM2 da API. Isso não é
 * detalhe de empacotamento:
 *
 *  - ffmpeg é CPU-bound e demorado. Dentro do processo da API, seguraria um dos
 *    2 workers do cluster e travaria GTPP, EPP, GIPP-RH e chat junto.
 *  - O cluster tem 2 instâncias. Um worker de fila rodando ali seria executado
 *    DUAS vezes, e o mesmo job seria convertido em duplicidade.
 *
 * Fluxo de cada ciclo:
 *   1. devolve à fila jobs presos (worker morto no meio)
 *   2. reserva o job pendente mais antigo (FOR UPDATE SKIP LOCKED)
 *   3. converte para H.264/MP4 com ffmpeg
 *   4. troca o arquivo em disco e atualiza `_files` (inclusive o hash)
 *   5. marca os anexos como prontos e emite o evento WS tipo 11
 *
 * @module workers/video-transcoder
 */

'use strict';

require('dotenv').config();

const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const crypto   = require('crypto');
const { execFile } = require('child_process');

const { poolGlobal } = require('../config/mysql');
const {
    SQL_CLAIM_SELECT, SQL_CLAIM_MARK, SQL_MARK_DONE, SQL_MARK_FAILED,
    SQL_RELEASE_STUCK, SQL_REPLACE_FILE, SQL_SET_ATTACHMENT_STATUS,
    SQL_FIND_AFFECTED_TASKS,
    SQL_LIST_VIDEOS_WITHOUT_POSTER, SQL_SET_POSTER_PATH, SQL_BUMP_POSTER_ATTEMPT,
} = require('../modules/global/repositories/mysql/video-transcode.queries');
const { SQL_SET_MEDIA_STATUS_BY_FILE } = require('../modules/global/repositories/mysql/miepp-media.queries');
const {
    TARGET_VIDEO_CODEC, TARGET_MIME, TARGET_EXTENSION,
    MAX_ATTEMPTS, STUCK_AFTER_MINUTES, buildFfmpegArgs,
} = require('../utils/video/transcode-policy');
const {
    POSTER_TIMEOUT_MS, POSTER_BATCH_SIZE, POSTER_SEEK_SECONDS,
    posterPathFor, buildPosterArgs,
} = require('../utils/video/poster-policy');

/** Tentativas de capa antes de desistir daquele vídeo. */
const POSTER_MAX_ATTEMPTS = Number(process.env.VIDEO_POSTER_MAX_ATTEMPTS || 3);

/** Mesma raiz usada pelo FileService para resolver `file_path`. */
const STORAGE_ROOT = path.resolve(__dirname, '..', '..');

const FFMPEG_BIN     = process.env.FFMPEG_PATH || 'ffmpeg';
const POLL_INTERVAL  = Number(process.env.VIDEO_POLL_INTERVAL_MS || 10000);
/** Teto de tempo por vídeo. Sem isto, um arquivo corrompido pode pendurar o worker. */
const FFMPEG_TIMEOUT = Number(process.env.VIDEO_FFMPEG_TIMEOUT_MS || 30 * 60 * 1000);
const WORKER_ID      = `${os.hostname()}:${process.pid}`;

/** Emissão do evento WS é opcional — o worker não deve morrer se o WS estiver fora. */
let eventPublisher = null;
try {
    const { HttpGtppEventPublisher } = require('../modules/global/infrastructure/gtpp/http-gtpp-event.publisher');
    eventPublisher = new HttpGtppEventPublisher();
} catch (err) {
    console.error('[transcoder] Publisher WS indisponível, seguindo sem evento:', err.message);
}

/** Tipo 11 = anexo processado. Tipo novo de propósito: o 10 já carrega dois significados. */
const EV_ATTACHMENT_PROCESSED = 11;

let shuttingDown = false;

// ─── Passos ───────────────────────────────────────────────────────────────────

/**
 * Reserva um job. A transação existe para o `SKIP LOCKED` valer — fora dela o
 * lock cai imediatamente e dois workers pegariam a mesma linha.
 *
 * @returns {Promise<?object>} Job reservado, ou null se a fila está vazia.
 */
async function claimJob() {
    const conn = await poolGlobal.getConnection();
    try {
        await conn.beginTransaction();

        const [[job]] = await conn.execute(SQL_CLAIM_SELECT);
        if (!job) {
            await conn.commit();
            return null;
        }

        await conn.execute(SQL_CLAIM_MARK, [WORKER_ID, job.id]);
        await conn.commit();
        return job;
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Roda o ffmpeg. Usa `execFile` (sem shell): os argumentos vão como array, então
 * nome de arquivo com espaço, acento ou aspas não precisa de escape nem abre
 * espaço para injeção de comando.
 */
function runFfmpeg(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        execFile(
            FFMPEG_BIN,
            buildFfmpegArgs(inputPath, outputPath),
            { timeout: FFMPEG_TIMEOUT, maxBuffer: 1024 * 1024 },
            (err, _stdout, stderr) => {
                if (err) {
                    const detail = (stderr || err.message || '').trim().slice(0, 450);
                    return reject(new Error(detail || 'ffmpeg falhou sem mensagem'));
                }
                resolve();
            }
        );
    });
}

/** SHA-256 em streaming — o arquivo convertido nunca precisa caber inteiro em RAM. */
function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash   = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

/** Mesmo layout do `FileService._buildPaths`: Storage/{MODULO}/uploads/{ano}/{mes}/{dia}/{hash}.{ext} */
function buildOutputPaths(originalRelativePath, newHash) {
    const dir          = path.dirname(originalRelativePath);
    const relativePath = path.posix.join(dir.split(path.sep).join('/'), `${newHash}.${TARGET_EXTENSION}`);
    return { relativePath, absolutePath: path.join(STORAGE_ROOT, relativePath) };
}

/**
 * Avisa os clientes de que o anexo ficou pronto.
 *
 * Um mesmo arquivo pode estar em comentários de várias tarefas (deduplicação por
 * hash), então emite um evento por tarefa afetada. Arquivo de chat não retorna
 * tarefa nenhuma e não gera evento.
 */
async function notifyReady(fileId, status) {
    if (!eventPublisher) return;

    const [rows] = await poolGlobal.execute(SQL_FIND_AFFECTED_TASKS, [fileId]);
    const seen   = new Set();

    for (const row of rows) {
        const key = `${row.task_id}:${row.response_id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        await eventPublisher
            .broadcastEvent(row.task_id, null, EV_ATTACHMENT_PROCESSED, {
                action: 'file_processed',
                id: row.response_id,
                item_id: row.item_id,
                file_id: fileId,
                processing_status: status,
            })
            .catch(err => console.error('[transcoder] Falha ao emitir evento:', err.message));
    }
}

/**
 * Espelha o ciclo de vida da conversão em `miepp_media`.
 *
 * O mesmo arquivo de `_files` pode ser anexo de tarefa GTPP **e** mídia do
 * miepp (o storage deduplica por hash), então os dois consumidores são
 * atualizados lado a lado. Sem isto, um vídeo do miepp nasceria `processing` e
 * ficaria assim para sempre — o player nunca o receberia, e não haveria erro
 * em lugar nenhum apontando o motivo.
 *
 * Roda FORA da transação que troca o arquivo em `_files`, e nunca derruba o
 * job: aquela transação é o caminho crítico do GTPP, e o miepp pode ser
 * atualizado em seguida sem risco de desfazer a conversão. Se esta escrita
 * falhar, a mídia fica no status anterior e o pior caso é o operador reenviar.
 *
 * @param {'processing'|'ready'|'error'} status - valor do ENUM `miepp_media.status`.
 * @param {number} fileId
 */
async function setMieppMediaStatus(status, fileId) {
    try {
        // `miepp_media.file_id` é VARCHAR: o parâmetro vai como string para a
        // comparação não cair em conversão implícita.
        await poolGlobal.execute(SQL_SET_MEDIA_STATUS_BY_FILE, [status, String(fileId)]);
    } catch (err) {
        console.error('[transcoder] Falha ao atualizar miepp_media:', err.message);
    }
}

/**
 * Converte um job do começo ao fim.
 *
 * O original só é apagado DEPOIS do commit no banco. Se a ordem fosse invertida
 * e o UPDATE falhasse, `_files` apontaria para um arquivo que não existe mais —
 * e a evidência do usuário estaria perdida.
 */
async function processJob(job) {
    const inputAbsolute = path.join(STORAGE_ROOT, job.file_path);

    if (!fs.existsSync(inputAbsolute)) {
        throw new Error(`Arquivo ausente em disco: ${job.file_path}`);
    }

    await poolGlobal.execute(SQL_SET_ATTACHMENT_STATUS, ['processing', job.file_id]);
    await setMieppMediaStatus('processing', job.file_id);

    const tempOutput = path.join(os.tmpdir(), `transcode-${job.id}-${Date.now()}.${TARGET_EXTENSION}`);

    try {
        const startedAt = Date.now();
        await runFfmpeg(inputAbsolute, tempOutput);

        const { size: resultSize } = fs.statSync(tempOutput);
        const newHash              = await hashFile(tempOutput);
        const { relativePath, absolutePath } = buildOutputPaths(job.file_path, newHash);

        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.copyFileSync(tempOutput, absolutePath);
        fs.chmodSync(absolutePath, 0o644);

        const conn = await poolGlobal.getConnection();
        try {
            await conn.beginTransaction();
            await conn.execute(SQL_REPLACE_FILE, [
                relativePath, TARGET_EXTENSION, TARGET_MIME, resultSize, newHash, TARGET_VIDEO_CODEC, job.file_id,
            ]);
            await conn.execute(SQL_SET_ATTACHMENT_STATUS, ['ready', job.file_id]);
            await conn.execute(SQL_MARK_DONE, [resultSize, job.id]);
            await conn.commit();
        } catch (err) {
            await conn.rollback().catch(() => {});
            // Remove a saída órfã: o banco não a referencia.
            fs.unlinkSync(absolutePath);
            throw err;
        } finally {
            conn.release();
        }

        // Só agora o original pode ir embora. Se o caminho não mudou (mesmo
        // hash, arquivo idêntico), não apaga nada.
        if (inputAbsolute !== absolutePath) {
            try { fs.unlinkSync(inputAbsolute); }
            catch (err) { console.error('[transcoder] Original não removido:', err.message); }
        }

        const saved = job.file_size ? Math.round((1 - resultSize / job.file_size) * 100) : 0;
        console.log(
            `[transcoder] job=${job.id} file=${job.file_id} ${job.video_codec || '?'} → h264 | ` +
            `${(job.file_size / 1048576).toFixed(1)}MB → ${(resultSize / 1048576).toFixed(1)}MB (-${saved}%) | ` +
            `${((Date.now() - startedAt) / 1000).toFixed(0)}s`
        );

        await setMieppMediaStatus('ready', job.file_id);
        await notifyReady(job.file_id, 'ready');
    } finally {
        try { fs.unlinkSync(tempOutput); } catch { /* já removido */ }
    }
}

/**
 * Falha o job. O arquivo original permanece intacto e utilizável — recusar a
 * evidência que o usuário já subiu seria pior do que entregá-la sem converter.
 */
async function failJob(job, err) {
    console.error(`[transcoder] job=${job.id} file=${job.file_id} FALHOU: ${err.message}`);

    await poolGlobal.execute(SQL_MARK_FAILED, [MAX_ATTEMPTS, err.message.slice(0, 450), job.id])
        .catch(e => console.error('[transcoder] Falha ao marcar o job:', e.message));

    const finalAttempt = job.attempts + 1 >= MAX_ATTEMPTS;
    if (finalAttempt) {
        await poolGlobal.execute(SQL_SET_ATTACHMENT_STATUS, ['failed', job.file_id]).catch(() => {});

        // No miepp a falha final vira `error`, e não `ready`.
        //
        // O arquivo original continua intacto e poderia ser servido sem
        // conversão — é o que o GTPP faz, porque lá um anexo que o navegador
        // não abre ainda é evidência baixável. Numa tela de loja não: o codec
        // que motivou a conversão é justamente o que a caixa Android tende a
        // não decodificar, e o resultado seria um quadro preto no meio da
        // veiculação, sem ninguém saber por quê. Com `error` a mídia fica fora
        // da playlist E aparece marcada no painel, que é onde o operador pode
        // reagir e reenviar noutro formato.
        await setMieppMediaStatus('error', job.file_id);

        await notifyReady(job.file_id, 'failed').catch(() => {});
    }
}

// ─── Quadro de capa ───────────────────────────────────────────────────────────

/**
 * Extrai um quadro do vídeo com ffmpeg.
 *
 * Vídeo mais curto que o ponto de busca faz o ffmpeg terminar sem escrever
 * nada — sem erro, só um arquivo ausente. Por isso a segunda tentativa no
 * segundo zero em vez de desistir: um vídeo de 2 segundos é raro, mas existe.
 */
function runPosterFfmpeg(inputPath, outputPath, seekSeconds) {
    return new Promise((resolve, reject) => {
        execFile(
            FFMPEG_BIN,
            buildPosterArgs(inputPath, outputPath, seekSeconds),
            { timeout: POSTER_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
            (err, _stdout, stderr) => {
                if (err) {
                    const detail = (stderr || err.message || '').trim().slice(0, 450);
                    return reject(new Error(detail || 'ffmpeg falhou sem mensagem'));
                }
                resolve();
            }
        );
    });
}

/**
 * Gera a capa de UM vídeo.
 *
 * A tentativa é contada antes da extração: o caso que precisa de teto é
 * justamente o arquivo que pendura ou derruba o worker, e aí nenhum `UPDATE`
 * posterior chegaria a rodar.
 *
 * @returns {Promise<boolean>} true quando a capa foi gravada.
 */
async function generatePoster(file) {
    const inputAbsolute = path.join(STORAGE_ROOT, file.file_path);

    await poolGlobal.execute(SQL_BUMP_POSTER_ATTEMPT, [file.id]);

    if (!fs.existsSync(inputAbsolute)) {
        console.warn(`[poster] file=${file.id} sem arquivo em disco: ${file.file_path}`);
        return false;
    }

    const posterRelative = posterPathFor(file.file_path);
    const posterAbsolute = path.join(STORAGE_ROOT, posterRelative);

    fs.mkdirSync(path.dirname(posterAbsolute), { recursive: true });

    for (const seek of [POSTER_SEEK_SECONDS, 0]) {
        await runPosterFfmpeg(inputAbsolute, posterAbsolute, seek);
        if (fs.existsSync(posterAbsolute) && fs.statSync(posterAbsolute).size > 0) break;
    }

    if (!fs.existsSync(posterAbsolute) || fs.statSync(posterAbsolute).size === 0) {
        try { fs.unlinkSync(posterAbsolute); } catch { /* nem chegou a existir */ }
        throw new Error('ffmpeg não escreveu quadro algum');
    }

    fs.chmodSync(posterAbsolute, 0o644);
    await poolGlobal.execute(SQL_SET_POSTER_PATH, [posterRelative, file.id]);

    return true;
}

/**
 * Varre os vídeos sem capa e gera em lote.
 *
 * Roda DEPOIS da fila de conversão no mesmo ciclo, e não em paralelo: a
 * conversão é o trabalho que alguém está esperando, a capa é manutenção. Um
 * lote pequeno por ciclo mantém o worker responsivo à fila.
 *
 * Falha de um vídeo nunca interrompe o lote — mesma regra do render da grade.
 */
async function posterTick() {
    const [files] = await poolGlobal.query(
        SQL_LIST_VIDEOS_WITHOUT_POSTER,
        [POSTER_MAX_ATTEMPTS, POSTER_BATCH_SIZE]
    );

    if (files.length === 0) return;

    let generated = 0;
    for (const file of files) {
        if (shuttingDown) break;

        try {
            if (await generatePoster(file)) generated += 1;
        } catch (err) {
            console.error(`[poster] file=${file.id} falhou:`, err.message);
        }
    }

    if (generated > 0) {
        console.log(`[poster] ${generated} capa(s) gerada(s) de ${files.length} vídeo(s) examinado(s)`);
    }
}

// ─── Laço principal ───────────────────────────────────────────────────────────

/**
 * Registra erro repetido sem encher o log.
 *
 * Uma falha permanente — tabela ausente, credencial errada, disco cheio — se
 * repete a cada ciclo. A 10 segundos por ciclo isso são 8.640 linhas idênticas
 * por dia, que afogam justamente o que apareceu uma vez só e importava. Loga a
 * primeira, cala enquanto a mensagem for a mesma e volta a avisar a cada 60
 * repetições (~10 min), sempre dizendo quantas houve.
 */
function makeErrorThrottle(prefix) {
    let last = null;
    let repeats = 0;

    return (message) => {
        if (message !== last) {
            last = message;
            repeats = 0;
            console.error(`${prefix} ${message}`);
            return;
        }

        repeats += 1;
        if (repeats % 60 === 0) {
            console.error(`${prefix} ${message} (repetido ${repeats}x)`);
        }
    };
}

const logQueueError  = makeErrorThrottle('[transcoder] Erro na fila de conversão:');
const logPosterError = makeErrorThrottle('[poster] Erro na varredura:');

/**
 * Fila de conversão: devolve os presos e drena o que houver.
 *
 * Depende de `gt_video_transcode_queue`.
 */
async function transcodeTick() {
    const [released] = await poolGlobal.execute(SQL_RELEASE_STUCK, [STUCK_AFTER_MINUTES]);
    if (released.affectedRows > 0) {
        console.warn(`[transcoder] ${released.affectedRows} job(s) preso(s) devolvido(s) à fila`);
    }

    // Drena a fila inteira antes de voltar a dormir.
    while (!shuttingDown) {
        const job = await claimJob();
        if (!job) break;

        try { await processJob(job); }
        catch (err) { await failJob(job, err); }
    }
}

/**
 * As duas metades do ciclo são INDEPENDENTES, e cada uma tem seu próprio
 * try/catch por um motivo concreto.
 *
 * A conversão depende de `gt_video_transcode_queue`; a varredura de capas
 * depende só de `_files`. Quando as duas dividiam o mesmo tratamento de erro, o
 * banco sem a tabela da fila fazia o ciclo estourar na PRIMEIRA linha e nenhuma
 * capa chegava a ser gerada — um recurso parado por causa de outro que não tem
 * relação com ele (18/09/2026).
 *
 * A ordem também não é arbitrária: conversão é o que alguém está esperando,
 * capa é manutenção.
 */
async function tick() {
    try { await transcodeTick(); }
    catch (err) { logQueueError(err.message); }

    if (shuttingDown) return;

    try { await posterTick(); }
    catch (err) { logPosterError(err.message); }
}

async function main() {
    console.log(`[transcoder] iniciado — worker=${WORKER_ID}, poll=${POLL_INTERVAL}ms, ffmpeg=${FFMPEG_BIN}`);

    for (const signal of ['SIGTERM', 'SIGINT']) {
        process.on(signal, () => {
            console.log(`[transcoder] ${signal} recebido — encerrando após o job atual`);
            shuttingDown = true;
        });
    }

    while (!shuttingDown) {
        try { await tick(); }
        catch (err) { console.error('[transcoder] Erro no ciclo:', err.message); }

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    await poolGlobal.end().catch(() => {});
    console.log('[transcoder] encerrado');
    process.exit(0);
}

if (require.main === module) main();

module.exports = { claimJob, processJob, failJob, buildOutputPaths, hashFile };
