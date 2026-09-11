const { probeVideoCodec } = require('../video-codec');

// ─── Construtores de MP4 sintético ────────────────────────────────────────────

/** Um box ISO-BMFF: [tamanho de 4 bytes][tipo de 4 bytes][conteúdo]. */
function box(type, ...payload) {
    const body = Buffer.concat(payload.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'latin1'))));
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length + 8, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
}

/** Sample entry: o fourcc é o que identifica o codec. */
function sampleEntry(fourcc) {
    return box(fourcc, Buffer.alloc(24));
}

/** Box stsd: versão/flags + contagem + entradas. */
function stsd(...entries) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(entries.length, 4);
    return box('stsd', header, ...entries);
}

/** Uma faixa completa, com o stsd no fundo da hierarquia real. */
function trak(fourcc) {
    return box('trak', box('mdia', box('minf', box('stbl', stsd(sampleEntry(fourcc))))));
}

/** Arquivo MP4 mínimo. `moovFirst=false` põe o moov depois do mdat. */
function mp4({ video, audio, moovFirst = true } = {}) {
    const traks = [];
    if (video) traks.push(trak(video));
    if (audio) traks.push(trak(audio));

    const ftyp = box('ftyp', 'isom\0\0\0\0isom');
    const moov = box('moov', ...traks);
    const mdat = box('mdat', Buffer.alloc(512));

    return moovFirst
        ? Buffer.concat([ftyp, moov, mdat])
        : Buffer.concat([ftyp, mdat, moov]);
}

/** WebM/Matroska mínimo, com o CodecID em texto puro. */
function webm(codecId) {
    return Buffer.concat([
        Buffer.from([0x1A, 0x45, 0xDF, 0xA3]),
        Buffer.from('\x42\x82webm', 'latin1'),
        Buffer.from(codecId, 'latin1'),
        Buffer.alloc(64),
    ]);
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('probeVideoCodec — MP4 / MOV', () => {
    it('should identify H.264 and mark it as web safe', () => {
        expect(probeVideoCodec(mp4({ video: 'avc1', audio: 'mp4a' }), 'video/mp4'))
            .toEqual({ video: 'h264', audio: 'aac', webSafe: true });
    });

    // O caso que motivou o módulo: iPhone gravando em "alta eficiência".
    it('should identify HEVC and mark it as NOT web safe', () => {
        expect(probeVideoCodec(mp4({ video: 'hvc1', audio: 'mp4a' }), 'video/mp4'))
            .toEqual({ video: 'hevc', audio: 'aac', webSafe: false });
    });

    it('should identify both HEVC fourcc variants', () => {
        expect(probeVideoCodec(mp4({ video: 'hev1' }), 'video/mp4').video).toBe('hevc');
        expect(probeVideoCodec(mp4({ video: 'hvc1' }), 'video/mp4').video).toBe('hevc');
    });

    it('should identify both H.264 fourcc variants', () => {
        expect(probeVideoCodec(mp4({ video: 'avc1' }), 'video/mp4').video).toBe('h264');
        expect(probeVideoCodec(mp4({ video: 'avc3' }), 'video/mp4').video).toBe('h264');
    });

    it('should find the moov even when it comes after the mdat', () => {
        // Gravação sequencial (captura de tela, câmera) põe o moov no fim.
        const probe = probeVideoCodec(mp4({ video: 'avc1', audio: 'mp4a', moovFirst: false }), 'video/mp4');
        expect(probe).toEqual({ video: 'h264', audio: 'aac', webSafe: true });
    });

    it('should treat AV1 and VP9 as not universally playable', () => {
        expect(probeVideoCodec(mp4({ video: 'av01' }), 'video/mp4')).toMatchObject({ video: 'av1', webSafe: false });
        expect(probeVideoCodec(mp4({ video: 'vp09' }), 'video/mp4')).toMatchObject({ video: 'vp9', webSafe: false });
    });

    it('should return the raw fourcc for a codec it does not know yet', () => {
        expect(probeVideoCodec(mp4({ video: 'zzzz' }), 'video/mp4')).toMatchObject({ video: 'zzzz', webSafe: false });
    });

    it('should handle a video-only file with no audio track', () => {
        expect(probeVideoCodec(mp4({ video: 'avc1' }), 'video/mp4'))
            .toEqual({ video: 'h264', audio: null, webSafe: true });
    });
});

describe('probeVideoCodec — WebM', () => {
    it('should identify VP9 and AV1', () => {
        expect(probeVideoCodec(webm('V_VP9'), 'video/webm').video).toBe('vp9');
        expect(probeVideoCodec(webm('V_AV1'), 'video/webm').video).toBe('av1');
    });

    it('should identify HEVC inside Matroska', () => {
        expect(probeVideoCodec(webm('V_MPEGH/ISO/HEVC'), 'video/webm'))
            .toMatchObject({ video: 'hevc', webSafe: false });
    });
});

describe('probeVideoCodec — robustez', () => {
    // Sondagem é diagnóstico: recusar upload porque o parse falhou seria pior
    // do que aceitar sem saber o codec.
    it('should never throw on garbage, returning nulls instead', () => {
        for (const junk of [Buffer.alloc(0), Buffer.alloc(4), Buffer.from('não é vídeo'), Buffer.alloc(1000, 0xFF)]) {
            expect(() => probeVideoCodec(junk, 'video/mp4')).not.toThrow();
            expect(probeVideoCodec(junk, 'video/mp4').webSafe).toBe(false);
        }
    });

    it('should not loop forever on a box that declares size zero', () => {
        const broken = Buffer.concat([Buffer.alloc(4), Buffer.from('moov', 'latin1'), Buffer.alloc(64)]);
        expect(() => probeVideoCodec(broken, 'video/mp4')).not.toThrow();
    });

    it('should stop on a box whose declared size runs past the buffer', () => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(0xFFFFFF, 0);
        head.write('moov', 4, 'latin1');
        expect(probeVideoCodec(Buffer.concat([head, Buffer.alloc(32)]), 'video/mp4').video).toBeNull();
    });
});
