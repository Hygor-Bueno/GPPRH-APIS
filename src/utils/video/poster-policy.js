/**
 * @fileoverview Regras puras do quadro de capa do vídeo — sem I/O.
 *
 * Separado do worker pelo mesmo motivo do `transcode-policy`: é a parte que
 * decide *se* e *como* extrair, e a única testável sem ffmpeg instalado.
 *
 * **Por que existe capa.** A miniatura de vídeo no painel era desenhada pedindo
 * um Range do próprio `.mp4` (`#t=0.1`). Funciona, mas cada miniatura abre um
 * streaming que atravessa Apache → Node → disco, e o navegador corta a conexão
 * assim que pinta o quadro. Com 50 mídias por página isso vira centenas de
 * conexões abortadas, os processos de proxy do Apache ficam presos segurando
 * vídeo e qualquer requisição nova leva 502 — inclusive um `OPTIONS` de
 * preflight (incidente de 18/09/2026, 239 abortos em uma semana, todos `.mp4`).
 *
 * Uma capa é um JPEG de poucos KB servido como imagem comum: entra no cache do
 * navegador, não usa Range e não segura processo nenhum.
 *
 * @module utils/video/poster-policy
 */

'use strict';

const path = require('path');

/** Extensão e MIME da capa. JPEG, e não WebP, porque é o que toda TV e navegador antigo abrem. */
const POSTER_EXTENSION = 'jpg';
const POSTER_MIME      = 'image/jpeg';

/**
 * Sufixo que distingue a capa do vídeo no mesmo diretório.
 *
 * O arquivo em disco é `{hash}.mp4`, então a capa vira `{hash}.poster.jpg`. É
 * derivável do caminho do vídeo, o que dispensa uma linha própria em `_files`:
 * a capa não é um arquivo do usuário, é um derivado do que ele subiu.
 */
const POSTER_SUFFIX = '.poster';

/**
 * Largura máxima da capa. Vídeo mais estreito NÃO é ampliado (`min(largura, iw)`).
 *
 * 640px cobre a miniatura em tela cheia com folga. Subir isso não melhora o que
 * o painel mostra e só engorda o que trafega.
 */
const POSTER_MAX_WIDTH = Number(process.env.VIDEO_POSTER_WIDTH || 640);

/** Qualidade do JPEG no ffmpeg (`-q:v`): 2 é o melhor, 31 o pior. */
const POSTER_QUALITY = Number(process.env.VIDEO_POSTER_QUALITY || 4);

/**
 * Onde buscar o quadro, em segundos.
 *
 * O primeiro quadro costuma ser preto (fade-in, claquete, letreiro). Um
 * segundo adiante já pega conteúdo na maioria dos vídeos de prateleira.
 */
const POSTER_SEEK_SECONDS = Number(process.env.VIDEO_POSTER_SEEK_SECONDS || 1);

/** Teto de tempo da extração. É um quadro só; passar disso é arquivo problemático. */
const POSTER_TIMEOUT_MS = Number(process.env.VIDEO_POSTER_TIMEOUT_MS || 60 * 1000);

/** Quantos vídeos sem capa o worker processa por ciclo. */
const POSTER_BATCH_SIZE = Number(process.env.VIDEO_POSTER_BATCH_SIZE || 5);

/**
 * Um arquivo merece capa?
 *
 * Qualquer `video/*`, e não só os transcodáveis: um vídeo que já chegou em
 * H.264 pequeno nunca entra na fila de conversão, mas aparece na biblioteca do
 * painel exatamente como os outros — e é miniatura dele também que derruba o
 * proxy.
 *
 * @param {{mime_type?: string, file_type?: string}} file
 * @returns {boolean}
 */
function needsPoster(file) {
    const mime = file?.mime_type ?? file?.file_type ?? '';
    return String(mime).startsWith('video/');
}

/**
 * Caminho da capa a partir do caminho do vídeo, preservando o diretório.
 *
 * @param {string} videoRelativePath - ex.: `Storage/MIEPP/uploads/2026/09/16/abc.mp4`
 * @returns {string} ex.: `Storage/MIEPP/uploads/2026/09/16/abc.poster.jpg`
 */
function posterPathFor(videoRelativePath) {
    const normalized = String(videoRelativePath).split(path.sep).join('/');
    const dir  = path.posix.dirname(normalized);
    const base = path.posix.basename(normalized, path.posix.extname(normalized));

    return path.posix.join(dir, `${base}${POSTER_SUFFIX}.${POSTER_EXTENSION}`);
}

/**
 * Argumentos do ffmpeg para extrair um quadro.
 *
 * `-ss` vem ANTES de `-i` de propósito: assim o ffmpeg busca por índice em vez
 * de decodificar o vídeo inteiro até o ponto, e a extração custa milissegundos
 * em vez de segundos num arquivo longo.
 *
 * `scale=min(N,iw):-2` mantém a proporção e garante altura par, que o encoder
 * JPEG exige. `-frames:v 1` para no primeiro quadro.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} [seekSeconds] - padrão `POSTER_SEEK_SECONDS`.
 * @returns {string[]}
 */
function buildPosterArgs(inputPath, outputPath, seekSeconds = POSTER_SEEK_SECONDS) {
    return [
        '-ss', String(Math.max(0, Number(seekSeconds) || 0)),
        '-i', inputPath,
        '-frames:v', '1',
        '-vf', `scale='min(${POSTER_MAX_WIDTH},iw)':-2`,
        '-q:v', String(POSTER_QUALITY),
        '-y',
        outputPath,
    ];
}

module.exports = {
    POSTER_EXTENSION,
    POSTER_MIME,
    POSTER_SUFFIX,
    POSTER_MAX_WIDTH,
    POSTER_QUALITY,
    POSTER_SEEK_SECONDS,
    POSTER_TIMEOUT_MS,
    POSTER_BATCH_SIZE,
    needsPoster,
    posterPathFor,
    buildPosterArgs,
};
