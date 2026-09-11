/**
 * @fileoverview Identificação do codec de vídeo sem depender de ffmpeg.
 *
 * O MIME `video/mp4` diz o CONTÊINER, não o codec. Dentro dele pode vir H.264
 * ou HEVC (H.265), e a diferença é decisiva na prática: HEVC é o padrão de
 * gravação do iPhone e de Android com "alta eficiência" ligado, mas não toca no
 * Windows sem o pacote pago "Extensões de Vídeo HEVC" — nem no Media Player,
 * nem no Chrome/Edge/Firefox. O anexo sobe, é armazenado, é baixado, e o
 * usuário vê um player preto.
 *
 * Como extensão e MIME são idênticos nos dois casos, a única forma de separar é
 * ler a estrutura do arquivo. É o que este módulo faz: caminha a árvore de
 * boxes ISO-BMFF até `stsd` e lê o fourcc do sample entry. Custa uma varredura
 * de alguns KB, não exige ffmpeg e não decodifica nada.
 *
 * @module utils/file/video-codec
 */

'use strict';

const fs = require('fs');

/** Boxes ISO-BMFF que contêm outros boxes — o walker desce nestes. */
const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);

/** fourcc do sample entry → nome normalizado do codec de vídeo. */
const VIDEO_FOURCC = {
    avc1: 'h264', avc3: 'h264',
    hvc1: 'hevc', hev1: 'hevc',
    av01: 'av1',
    vp08: 'vp8',  vp09: 'vp9',
    mp4v: 'mpeg4',
    jpeg: 'mjpeg',
};

/** fourcc do sample entry → nome normalizado do codec de áudio. */
const AUDIO_FOURCC = {
    'mp4a': 'aac',
    'ac-3': 'ac3', 'ec-3': 'eac3',
    'Opus': 'opus',
    '.mp3': 'mp3',
    'alac': 'alac',
    'lpcm': 'pcm', 'sowt': 'pcm', 'twos': 'pcm',
};

/** CodecID do Matroska/WebM → nome normalizado. */
const EBML_CODEC_IDS = [
    ['V_MPEGH/ISO/HEVC', 'hevc'],
    ['V_MPEG4/ISO/AVC',  'h264'],
    ['V_AV1',            'av1'],
    ['V_VP9',            'vp9'],
    ['V_VP8',            'vp8'],
];

/**
 * Codecs de vídeo que tocam em qualquer navegador e em qualquer Windows sem
 * instalar nada. Na prática é só H.264 — VP9 e AV1 dependem do navegador, e
 * HEVC depende de um pacote pago no Windows.
 *
 * @type {Set<string>}
 */
const WEB_SAFE_VIDEO_CODECS = new Set(['h264']);

/**
 * @typedef  {Object}  VideoProbe
 * @property {?string} video     - Codec de vídeo normalizado (`'h264'`, `'hevc'`…) ou o fourcc cru quando desconhecido.
 * @property {?string} audio     - Codec de áudio normalizado, quando houver faixa.
 * @property {boolean} webSafe   - `true` se toca em qualquer lugar sem instalar codec.
 */

/**
 * Descobre os codecs de um arquivo de vídeo já validado pelo `mime-detector`.
 *
 * Nunca lança: um arquivo com estrutura inesperada devolve `video: null`, e o
 * chamador decide o que fazer. Recusar upload por falha de sondagem seria pior
 * que aceitar sem saber o codec.
 *
 * @param {Buffer} buf      - Conteúdo completo do arquivo.
 * @param {string} mimeType - MIME já detectado (`video/mp4`, `video/quicktime`, `video/webm`).
 * @returns {VideoProbe}
 */
function probeVideoCodec(buf, mimeType) {
    let probe = { video: null, audio: null };

    try {
        if (mimeType === 'video/webm') {
            probe = _probeEbml(buf);
        } else {
            probe = _probeIsoBmff(buf);
        }
    } catch {
        // Estrutura inesperada — segue com o resultado vazio.
    }

    return { ...probe, webSafe: WEB_SAFE_VIDEO_CODECS.has(probe.video) };
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Caminha a árvore de boxes até `stsd` e lê os sample entries.
 *
 * O `moov` pode estar no início (arquivo otimizado para streaming) ou no fim
 * (gravação sequencial, caso das capturas de tela) — como o buffer inteiro está
 * em memória, os dois funcionam sem tratamento especial.
 *
 * @private
 * @param {Buffer} buf
 * @returns {{video: ?string, audio: ?string}}
 */
function _probeIsoBmff(buf) {
    const found = { video: null, audio: null };
    _walkBoxes(buf, 0, buf.length, 0, found);
    return found;
}

/**
 * @private
 * @param {Buffer} buf
 * @param {number} start @param {number} end @param {number} depth
 * @param {{video: ?string, audio: ?string}} found - Preenchido durante a caminhada.
 */
function _walkBoxes(buf, start, end, depth, found) {
    // Guarda contra recursão infinita em arquivo malformado.
    if (depth > 8) return;

    let offset = start;

    while (offset + 8 <= end) {
        let size      = buf.readUInt32BE(offset);
        const type    = buf.slice(offset + 4, offset + 8).toString('latin1');
        let headerLen = 8;

        if (size === 1) {
            // Box de 64 bits: o tamanho real vem logo depois do tipo.
            if (offset + 16 > end) return;
            size      = Number(buf.readBigUInt64BE(offset + 8));
            headerLen = 16;
        } else if (size === 0) {
            // Tamanho 0 = "vai até o fim do arquivo".
            size = end - offset;
        }

        // Tamanho incoerente: para em vez de sair lendo lixo como se fosse box.
        if (size < headerLen || offset + size > end) return;

        if (type === 'stsd') {
            _readSampleEntries(buf, offset + headerLen, offset + size, found);
        } else if (CONTAINER_BOXES.has(type)) {
            _walkBoxes(buf, offset + headerLen, offset + size, depth + 1, found);
        }

        offset += size;
    }
}

/**
 * Lê os fourcc dos sample entries dentro de um box `stsd`.
 *
 * Layout: 1 byte de versão + 3 de flags + 4 com a contagem de entradas, e então
 * as entradas, cada uma começando pelo próprio tamanho seguido do fourcc.
 *
 * @private
 */
function _readSampleEntries(buf, start, end, found) {
    if (start + 8 > end) return;

    const entryCount = buf.readUInt32BE(start + 4);
    let offset       = start + 8;

    for (let i = 0; i < entryCount && offset + 8 <= end; i++) {
        const entrySize = buf.readUInt32BE(offset);
        const fourcc    = buf.slice(offset + 4, offset + 8).toString('latin1');

        if (!found.video && VIDEO_FOURCC[fourcc]) {
            found.video = VIDEO_FOURCC[fourcc];
        } else if (!found.audio && AUDIO_FOURCC[fourcc]) {
            found.audio = AUDIO_FOURCC[fourcc];
        } else if (!found.video && !AUDIO_FOURCC[fourcc]) {
            // Codec de vídeo que ainda não mapeamos: devolve o fourcc cru, que
            // é mais útil para diagnóstico do que `null`.
            found.video = fourcc;
        }

        if (entrySize < 8) return;
        offset += entrySize;
    }
}

/**
 * Lê o CodecID do WebM/Matroska, que fica em texto puro no cabeçalho.
 *
 * @private
 * @param {Buffer} buf
 * @returns {{video: ?string, audio: ?string}}
 */
function _probeEbml(buf) {
    const head = buf.slice(0, Math.min(64 * 1024, buf.length)).toString('latin1');

    for (const [codecId, name] of EBML_CODEC_IDS) {
        if (head.includes(codecId)) {
            return { video: name, audio: head.includes('A_OPUS') ? 'opus' : null };
        }
    }

    return { video: null, audio: null };
}


/**
 * Sonda o codec lendo o arquivo em disco, sem carregá-lo inteiro em memória.
 *
 * Existe para o upload de vídeo grande, que com `diskStorage` chega como
 * caminho e não como Buffer — segurar 200 MB em RAM para descobrir 4 bytes de
 * fourcc é exatamente o que essa mudança veio evitar.
 *
 * Estratégia: percorre só os boxes de PRIMEIRO nível lendo 8 bytes por vez e
 * pulando pelo tamanho declarado, até achar o `moov`. Aí carrega só esse box
 * (tipicamente algumas dezenas de KB) e reaproveita o mesmo walker da versão em
 * memória. Funciona com o `moov` no começo ou no fim do arquivo.
 *
 * @param {string} filePath
 * @param {string} mimeType
 * @returns {VideoProbe}
 */
function probeVideoCodecFromFile(filePath, mimeType) {
    let probe = { video: null, audio: null };
    let fd = null;

    try {
        fd = fs.openSync(filePath, 'r');
        const { size } = fs.fstatSync(fd);

        if (mimeType === 'video/webm') {
            // O DocType e o CodecID ficam no cabeçalho — o começo basta.
            const head = Buffer.alloc(Math.min(64 * 1024, size));
            fs.readSync(fd, head, 0, head.length, 0);
            probe = _probeEbml(head);
        } else {
            const moov = _readMoovBox(fd, size);
            if (moov) _walkBoxes(moov, 0, moov.length, 0, probe);
        }
    } catch {
        // Arquivo ilegível ou estrutura inesperada: segue com o resultado vazio.
        // Sondagem é diagnóstico — recusar o upload por falha aqui seria pior.
    } finally {
        if (fd !== null) { try { fs.closeSync(fd); } catch { /* já fechado */ } }
    }

    return { ...probe, webSafe: WEB_SAFE_VIDEO_CODECS.has(probe.video) };
}

/**
 * Localiza e carrega o box `moov`, lendo apenas os cabeçalhos de primeiro nível.
 *
 * @private
 * @param {number} fd @param {number} fileSize
 * @returns {?Buffer} O box `moov` completo, ou null se não achar.
 */
function _readMoovBox(fd, fileSize) {
    const header = Buffer.alloc(16);
    let offset   = 0;

    while (offset + 8 <= fileSize) {
        const read = fs.readSync(fd, header, 0, 16, offset);
        if (read < 8) return null;

        let size      = header.readUInt32BE(0);
        const type    = header.slice(4, 8).toString('latin1');
        let headerLen = 8;

        if (size === 1) {
            if (read < 16) return null;
            size      = Number(header.readBigUInt64BE(8));
            headerLen = 16;
        } else if (size === 0) {
            size = fileSize - offset;
        }

        // Tamanho incoerente: para em vez de sair lendo lixo como se fosse box.
        if (size < headerLen || offset + size > fileSize) return null;

        if (type === 'moov') {
            // Teto de sanidade: um moov legítimo não passa de alguns MB, e sem
            // isto um cabeçalho corrompido pediria um Buffer gigante.
            const moovSize = Math.min(size, 32 * 1024 * 1024);
            const moov     = Buffer.alloc(moovSize);
            fs.readSync(fd, moov, 0, moovSize, offset);
            return moov;
        }

        offset += size;
    }

    return null;
}

module.exports = {
    probeVideoCodec,
    probeVideoCodecFromFile,
    WEB_SAFE_VIDEO_CODECS,
};
