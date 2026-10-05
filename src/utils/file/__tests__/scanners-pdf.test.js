const { scanPdfContent } = require('../scanners');
const { AppError } = require('../../../errors/app.error');

const pdf = (body) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF`, 'binary');

describe('scanPdfContent — links', () => {
    // O caso que motivou a mudança: a URL contém "/JavaScript/" e era lida como chave.
    it('should accept a /URI link whose URL contains a dangerous key name', () => {
        const body = '<</Type/Annot/Subtype/Link/A<</S/URI/URI(https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Guide)>>>>';
        expect(() => scanPdfContent(pdf(body))).not.toThrow();
    });

    it('should accept URLs with /AA/, /Launch/ and /XFA/ in the path', () => {
        const body = '<</A<</S/URI/URI(https://x.com/AA/Launch/XFA/?q=1)>>>>';
        expect(() => scanPdfContent(pdf(body))).not.toThrow();
    });

    it('should accept strings with escaped and nested parentheses', () => {
        const body = '<</A<</S/URI/URI(https://x.com/a\\)/JavaScript/(b)/AA/)>>>>';
        expect(() => scanPdfContent(pdf(body))).not.toThrow();
    });

    it('should accept plain internal and web links', () => {
        expect(() => scanPdfContent(pdf('<</A<</S/GoTo/D[3 0 R/Fit]>>>>'))).not.toThrow();
        expect(() => scanPdfContent(pdf('<< /A << /S /URI /URI (https://x.com) >> >>'))).not.toThrow();
    });
});

describe('scanPdfContent — /OpenAction de navegação', () => {
    // O caso real: export padrão do InDesign, que abre na página 1 com zoom "ajustar".
    it('should accept an InDesign-style /OpenAction pointing to a GoTo action', () => {
        const body = '43 0 obj<</OpenAction 44 0 R/Pages 39 0 R/Type/Catalog>>endobj44 0 obj<</D[45 0 R/Fit]/S/GoTo>>endobj';
        expect(() => scanPdfContent(pdf(body))).not.toThrow();
    });

    it('should accept an /OpenAction with a direct destination array', () => {
        expect(() => scanPdfContent(pdf('<</Type/Catalog/OpenAction [3 0 R /Fit]>>'))).not.toThrow();
    });

    it('should block an /OpenAction that opens another file (GoToR)', () => {
        const body = '<</OpenAction 9 0 R>>endobj 9 0 obj<</S/GoToR/F()/D[0/Fit]>>endobj';
        expect(() => scanPdfContent(pdf(body))).toThrow(AppError);
    });

    it('should block a GoTo /OpenAction that chains another action via /Next', () => {
        const body = '<</OpenAction 9 0 R>>endobj 9 0 obj<</S/GoTo/D[0/Fit]/Next 10 0 R>>endobj';
        expect(() => scanPdfContent(pdf(body))).toThrow(AppError);
    });

    it('should block an /OpenAction whose target object cannot be found', () => {
        expect(() => scanPdfContent(pdf('<</OpenAction 99 0 R>>'))).toThrow(AppError);
    });
});

describe('scanPdfContent — ameaças continuam bloqueadas', () => {
    it('should block /JavaScript actions', () => {
        expect(() => scanPdfContent(pdf('<</S/JavaScript/JS(app.alert(1))>>'))).toThrow(AppError);
    });

    it('should block /OpenAction placed right after a string', () => {
        expect(() => scanPdfContent(pdf('<</Title(x)/OpenAction 5 0 R>>'))).toThrow(AppError);
    });

    it('should block /Launch actions (links to local files)', () => {
        expect(() => scanPdfContent(pdf('<</A<</S/Launch/F(cmd.exe)>>>>'))).toThrow(AppError);
    });

    // Um "(" solto num corpo de stream não pode abrir uma string que esconda o resto.
    it('should not let an unbalanced "(" inside a stream hide later dictionaries', () => {
        const body = '1 0 obj<</Length 3>>stream\n(((\nendstream endobj\n2 0 obj<</OpenAction 3 0 R>>endobj';
        expect(() => scanPdfContent(pdf(body))).toThrow(AppError);
    });

    it('should still scan stream bodies as before', () => {
        const body = '1 0 obj<</Length 20>>stream\n<</S/JavaScript>>\nendstream endobj';
        expect(() => scanPdfContent(pdf(body))).toThrow(AppError);
    });
});
