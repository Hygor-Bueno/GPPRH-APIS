const {
    ISSUE, parseLegacyFileName, normalizeImei, legacyImeiCandidates, resolveAssetMatch, normalizeIdList, normalizeBatchSize,
} = require('../term-migration.rules');

describe('parseLegacyFileName', () => {
    test('código antes do PRIMEIRO hífen e o resto como responsável', () => {
        expect(parseLegacyFileName('1235-Nome do arquivo.pdf')).toEqual({ ok: true, legacyCode: 1235, responsibleName: 'Nome do arquivo' });
        expect(parseLegacyFileName('77-Maria-José Souza.PDF')).toEqual({ ok: true, legacyCode: 77, responsibleName: 'Maria-José Souza' });
    });

    test('tolera espaços em volta do hífen e colapsa espaços', () => {
        expect(parseLegacyFileName(' 0042 -  João   da Silva .pdf')).toEqual({ ok: true, legacyCode: 42, responsibleName: 'João da Silva' });
    });

    test('sem extensão também vale', () => {
        expect(parseLegacyFileName('10-Fulano')).toMatchObject({ ok: true, legacyCode: 10 });
    });

    test.each([
        ['Nome sem hifen.pdf'],
        ['ABC-Fulano.pdf'],
        ['12a-Fulano.pdf'],
        ['-Fulano.pdf'],
        ['0-Fulano.pdf'],
        ['99999999999-Fulano.pdf'],
        ['123-.pdf'],
        ['123-   .pdf'],
    ])('recusa "%s"', name => {
        expect(parseLegacyFileName(name).ok).toBe(false);
    });

    test('responsável é cortado em 100 caracteres', () => {
        const parsed = parseLegacyFileName(`5-${'x'.repeat(150)}.pdf`);
        expect(parsed.responsibleName).toHaveLength(100);
    });
});

describe('normalizeImei', () => {
    test('só dígitos; vazio, zeros e longo demais viram null', () => {
        expect(normalizeImei(' 35-123456 789012 3 ')).toBe('351234567890123');
        expect(normalizeImei('')).toBeNull();
        expect(normalizeImei(null)).toBeNull();
        expect(normalizeImei('000000000000000')).toBeNull();
        expect(normalizeImei('1234567890123456')).toBeNull();
        expect(normalizeImei('sem imei')).toBeNull();
    });
});

describe('legacyImeiCandidates', () => {
    test('imei1 primeiro, imei2 como alternativa, sem repetir', () => {
        expect(legacyImeiCandidates({ imei1: '111', imei2: '222' })).toEqual([
            { imei: '111', source: 'imei1' }, { imei: '222', source: 'imei2' },
        ]);
        expect(legacyImeiCandidates({ imei1: '', imei2: '222' })).toEqual([{ imei: '222', source: 'imei2' }]);
        expect(legacyImeiCandidates({ imei1: '111', imei2: '111' })).toEqual([{ imei: '111', source: 'imei1' }]);
        expect(legacyImeiCandidates({ imei1: null, imei2: null })).toEqual([]);
    });
});

describe('resolveAssetMatch', () => {
    const c = (imei1, imei2) => legacyImeiCandidates({ imei1, imei2 });

    test('sem IMEI no legado', () => {
        expect(resolveAssetMatch([], [])).toMatchObject({ ok: false, issue: ISSUE.LEGACY_WITHOUT_IMEI });
    });

    test('nenhum smartphone casa', () => {
        expect(resolveAssetMatch(c('111'), [])).toMatchObject({ ok: false, issue: ISSUE.ASSET_NOT_FOUND });
    });

    test('casa pelo imei1 (em imei_1 ou imei_2 da base nova)', () => {
        expect(resolveAssetMatch(c('111', '222'), [{ active_id: 9, imei_1: '222', imei_2: '111' }]))
            .toEqual({ ok: true, activeId: 9, imei: '111', imeiSource: 'imei1' });
    });

    test('imei1 vazio: usa o imei2 quando a correspondência é única', () => {
        expect(resolveAssetMatch(c('', '222'), [{ active_id: 5, imei_1: '222', imei_2: null }]))
            .toEqual({ ok: true, activeId: 5, imei: '222', imeiSource: 'imei2' });
    });

    test('imei1 sem par e imei2 casando: registra imei2', () => {
        expect(resolveAssetMatch(c('111', '222'), [{ active_id: 5, imei_1: '222' }]))
            .toMatchObject({ ok: true, activeId: 5, imeiSource: 'imei2' });
    });

    test('imei1 e imei2 em ativos diferentes é ambíguo', () => {
        const result = resolveAssetMatch(c('111', '222'), [{ active_id: 1, imei_1: '111' }, { active_id: 2, imei_1: '222' }]);
        expect(result).toMatchObject({ ok: false, issue: ISSUE.ASSET_AMBIGUOUS, activeIds: [1, 2] });
    });

    test('mesmo IMEI em dois cadastros é ambíguo', () => {
        const result = resolveAssetMatch(c('111'), [{ active_id: 1, imei_1: '111' }, { active_id: 3, imei_2: '111' }]);
        expect(result).toMatchObject({ ok: false, issue: ISSUE.ASSET_AMBIGUOUS });
    });

    test('ignora smartphones de outros IMEIs', () => {
        expect(resolveAssetMatch(c('111'), [{ active_id: 1, imei_1: '111' }, { active_id: 2, imei_1: '999' }]))
            .toMatchObject({ ok: true, activeId: 1 });
    });
});

describe('normalizeIdList / normalizeBatchSize', () => {
    test('ids', () => {
        expect(normalizeIdList(undefined, 10)).toBeNull();
        expect(normalizeIdList([3, '3', 'x', -1, 4], 10)).toEqual([3, 4]);
        expect(normalizeIdList([1, 2, 3], 2)).toEqual([1, 2]);
    });

    test('lote', () => {
        expect(normalizeBatchSize(undefined, { fallback: 10, max: 50 })).toBe(10);
        expect(normalizeBatchSize(500, { fallback: 10, max: 50 })).toBe(50);
        expect(normalizeBatchSize('3', { fallback: 10, max: 50 })).toBe(3);
    });
});
