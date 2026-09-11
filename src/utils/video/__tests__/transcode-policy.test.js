const {
    decideTranscode,
    buildFfmpegArgs,
    RECOMPRESS_ABOVE_BYTES,
} = require('../transcode-policy');

const MB = 1024 * 1024;

function video(overrides = {}) {
    return { file_type: 'video/mp4', video_codec: 'h264', file_size: 5 * MB, ...overrides };
}

describe('decideTranscode', () => {
    it('should transcode HEVC — the whole reason this exists', () => {
        expect(decideTranscode(video({ video_codec: 'hevc' })))
            .toEqual({ shouldTranscode: true, reason: 'codec_hevc' });
    });

    it('should transcode anything that is not H.264', () => {
        for (const codec of ['av1', 'vp9', 'mpeg4']) {
            expect(decideTranscode(video({ video_codec: codec })).shouldTranscode).toBe(true);
        }
    });

    // Reencodar um H.264 pequeno só perderia qualidade e queimaria CPU.
    it('should leave a small H.264 alone', () => {
        expect(decideTranscode(video({ video_codec: 'h264', file_size: 5 * MB })))
            .toEqual({ shouldTranscode: false, reason: 'already_h264_and_small' });
    });

    it('should still recompress an oversized H.264', () => {
        expect(decideTranscode(video({ video_codec: 'h264', file_size: RECOMPRESS_ABOVE_BYTES + 1 })))
            .toEqual({ shouldTranscode: true, reason: 'oversized' });
    });

    // Sem codec identificado não dá para afirmar que toca no navegador.
    it('should transcode when the codec could not be identified', () => {
        expect(decideTranscode(video({ video_codec: null })))
            .toEqual({ shouldTranscode: true, reason: 'codec_unknown' });
    });

    it('should never touch anything that is not video', () => {
        for (const mime of ['image/webp', 'application/pdf', 'text/csv', null]) {
            expect(decideTranscode({ file_type: mime, file_size: 500 * MB }))
                .toEqual({ shouldTranscode: false, reason: 'not_video' });
        }
    });

    it('should handle MOV and WebM as transcodable containers', () => {
        expect(decideTranscode(video({ file_type: 'video/quicktime', video_codec: 'hevc' })).shouldTranscode).toBe(true);
        expect(decideTranscode(video({ file_type: 'video/webm', video_codec: 'vp9' })).shouldTranscode).toBe(true);
    });

    it('should not throw on a malformed record', () => {
        expect(() => decideTranscode(undefined)).not.toThrow();
        expect(decideTranscode({}).shouldTranscode).toBe(false);
    });
});

describe('buildFfmpegArgs', () => {
    const args = buildFfmpegArgs('/in/a b.mp4', '/out/x.mp4');

    it('should target H.264 and AAC', () => {
        expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-c:a', 'aac']));
    });

    // Sem faststart o navegador só toca depois de baixar o arquivo inteiro —
    // gravação de câmera põe o índice (moov) no fim por padrão.
    it('should move the moov atom to the front', () => {
        expect(args).toEqual(expect.arrayContaining(['-movflags', '+faststart']));
    });

    // -2 mantém a altura par, exigência do H.264; min() evita ampliar vídeo menor.
    it('should downscale without upscaling, keeping the height even', () => {
        expect(args[args.indexOf('-vf') + 1]).toBe("scale='min(1280,iw)':-2");
    });

    it('should pass paths as separate arguments, never interpolated into a string', () => {
        // Garante que espaço em nome de arquivo não vira dois argumentos, e que
        // não há superfície de injeção (o worker usa execFile, sem shell).
        expect(args[args.indexOf('-i') + 1]).toBe('/in/a b.mp4');
        expect(args[args.length - 1]).toBe('/out/x.mp4');
        expect(args.every(a => typeof a === 'string')).toBe(true);
    });

    it('should overwrite the temp output instead of prompting', () => {
        expect(args).toContain('-y');
    });
});
