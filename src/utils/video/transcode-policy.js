/**
 * @fileoverview Regras puras da transcodificação de vídeo — sem I/O.
 *
 * Isolado do worker de propósito: é a parte que decide *se* e *como* converter,
 * e é a única que dá para testar sem ffmpeg instalado.
 *
 * @module utils/video/transcode-policy
 */

'use strict';

/** Codec de destino. H.264 é o único que toca em todo navegador, Windows e celular. */
const TARGET_VIDEO_CODEC = 'h264';
const TARGET_MIME        = 'video/mp4';
const TARGET_EXTENSION   = 'mp4';

/**
 * Largura máxima da saída. Vídeo mais estreito que isso NÃO é ampliado — o
 * filtro usa `min(largura, iw)`.
 */
const TARGET_MAX_WIDTH = Number(process.env.VIDEO_TARGET_WIDTH || 1280);

/**
 * Qualidade (CRF do x264): menor = melhor e maior. 26 é o ponto em que vídeo de
 * prateleira fica nítido o suficiente com ~10-15 MB por minuto. Use 23 se for
 * preciso ler etiqueta de produto — o arquivo fica aproximadamente 2x maior.
 */
const TARGET_CRF = Number(process.env.VIDEO_TARGET_CRF || 26);

/**
 * Preset do x264: troca CPU por tamanho. `veryfast` é deliberado — o servidor
 * não tem aceleração por hardware, e um preset mais lento multiplicaria o tempo
 * de fila para ganhar poucos MB.
 */
const TARGET_PRESET = process.env.VIDEO_TARGET_PRESET || 'veryfast';

/**
 * Acima deste tamanho, mesmo um H.264 já no formato alvo é reconvertido para
 * encolher. Abaixo, não vale queimar CPU nem perder qualidade reencodando.
 */
const RECOMPRESS_ABOVE_BYTES = Number(process.env.VIDEO_RECOMPRESS_ABOVE_BYTES || 20 * 1024 * 1024);

/** Tentativas antes de desistir de um job. */
const MAX_ATTEMPTS = Number(process.env.VIDEO_MAX_ATTEMPTS || 3);

/** Minutos sem heartbeat antes de considerar o job preso e devolvê-lo à fila. */
const STUCK_AFTER_MINUTES = Number(process.env.VIDEO_STUCK_AFTER_MINUTES || 30);

/** MIMEs que entram na fila. */
const TRANSCODABLE_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

/**
 * Decide se um arquivo deve entrar na fila de conversão.
 *
 * Um H.264 pequeno já é o formato alvo: converter só perderia qualidade e
 * queimaria CPU. O que precisa converter é o que não toca em todo lugar
 * (HEVC, AV1, VP9) ou o que está grande demais.
 *
 * @param {{file_type?: string, video_codec?: ?string, file_size?: number}} file
 * @returns {{ shouldTranscode: boolean, reason: string }}
 */
function decideTranscode(file) {
    const mime  = file?.file_type ?? null;
    const codec = file?.video_codec ?? null;
    const size  = Number(file?.file_size ?? 0);

    if (!TRANSCODABLE_MIMES.has(mime)) {
        return { shouldTranscode: false, reason: 'not_video' };
    }
    if (codec && codec !== TARGET_VIDEO_CODEC) {
        return { shouldTranscode: true, reason: `codec_${codec}` };
    }
    if (!codec) {
        // Sondagem não identificou o codec — converter é a opção segura, já que
        // não dá para afirmar que toca no navegador.
        return { shouldTranscode: true, reason: 'codec_unknown' };
    }
    if (size > RECOMPRESS_ABOVE_BYTES) {
        return { shouldTranscode: true, reason: 'oversized' };
    }
    return { shouldTranscode: false, reason: 'already_h264_and_small' };
}

/**
 * Monta os argumentos do ffmpeg. Devolve array (nunca string): o comando é
 * executado com `execFile`, sem shell, então nome de arquivo com espaço ou
 * acento não precisa de escape e não há superfície de injeção.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {string[]}
 */
function buildFfmpegArgs(inputPath, outputPath) {
    return [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',                                   // sobrescreve a saída temporária
        '-i', inputPath,
        '-c:v', 'libx264',
        '-preset', TARGET_PRESET,
        '-crf', String(TARGET_CRF),
        // Reduz só o que for maior que o alvo; -2 mantém a altura par, que o
        // H.264 exige. Sem isso, vídeo com altura ímpar falha a codificação.
        '-vf', `scale='min(${TARGET_MAX_WIDTH},iw)':-2`,
        '-c:a', 'aac',
        '-b:a', '128k',
        // Move o índice (`moov`) para o início. Sem isto o navegador só começa a
        // tocar depois de baixar o arquivo inteiro — e gravação de câmera põe o
        // moov no fim por padrão.
        '-movflags', '+faststart',
        outputPath,
    ];
}

module.exports = {
    TARGET_VIDEO_CODEC,
    TARGET_MIME,
    TARGET_EXTENSION,
    TARGET_MAX_WIDTH,
    TARGET_CRF,
    TARGET_PRESET,
    RECOMPRESS_ABOVE_BYTES,
    MAX_ATTEMPTS,
    STUCK_AFTER_MINUTES,
    TRANSCODABLE_MIMES,
    decideTranscode,
    buildFfmpegArgs,
};
