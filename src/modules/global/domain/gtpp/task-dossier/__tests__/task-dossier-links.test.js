const { buildDossierLinks } = require('../task-dossier-links');

describe('buildDossierLinks', () => {
    it('should return null without a valid http(s) base', () => {
        expect(buildDossierLinks(undefined)).toBeNull();
        expect(buildDossierLinks('')).toBeNull();
        expect(buildDossierLinks('gigpp.com.br:73')).toBeNull();
        expect(buildDossierLinks('javascript:alert(1)')).toBeNull();
    });

    it('should build the query contract the front reads, trimming the trailing slash', () => {
        const links = buildDossierLinks('https://gigpp.com.br:73/');
        expect(links.task(6415)).toBe('https://gigpp.com.br:73/services/gtpp?task=6415');
        expect(links.item(6415, 11)).toBe('https://gigpp.com.br:73/services/gtpp?task=6415&item=11');
        expect(links.itemFile(6415, 11)).toBe('https://gigpp.com.br:73/services/gtpp?task=6415&item=11&file=item');
        expect(links.responseFile(6415, 11, 501)).toBe('https://gigpp.com.br:73/services/gtpp?task=6415&item=11&attachment=501');
        expect(links.message(6415, 65)).toBe('https://gigpp.com.br:73/services/gtpp?task=6415&message=65');
    });
});
