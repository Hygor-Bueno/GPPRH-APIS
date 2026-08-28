const {
    readNfceQr,
    nfceCheckDigit,
    KEY_LENGTH,
    QR_LAYOUT,
} = require('../nfce-key');

// Duas chaves reais de producao, da mesma empresa e do mesmo mes.
//
// NORMAL: serie 101, nNF 371116, tpEmis 1, DV 7. E a que a query de referencia
// do Consinco consulta (nroempresa 1, dtamovimento 26-aug-2026).
const KEY_ONLINE = '35260860479680001252651010003711161934272357';

// CONTINGENCIA: serie 107, nNF 384153, tpEmis 9, DV 5. O QR dela tem 8 campos
// em vez de 5, e o campo 4 traz o dia (26) que a chave nao carrega.
const KEY_CONTINGENCY = '35260860479680001252651070003841539820368945';

const URL_ONLINE =
    `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY_ONLINE}|2|1|1|` +
    '8692A6704B35B27BEB409980C7A81D739E68F3B6';

const URL_CONTINGENCY =
    `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY_CONTINGENCY}|2|1|26|261.00|` +
    '4d474b3030302f734948304177467236306b4f5330513376696b673d|1|' +
    '98E4EAD7225D0DCA4437976E1265A20704FE16ED';

describe('nfceCheckDigit', () => {
    // Se este teste quebrar, o algoritmo mudou. Os dois valores foram somados a
    // mao a partir das chaves de producao acima.
    it('reproduz o DV das duas chaves de producao', () => {
        expect(nfceCheckDigit(KEY_ONLINE.slice(0, 43))).toBe(7);
        expect(nfceCheckDigit(KEY_CONTINGENCY.slice(0, 43))).toBe(5);
    });
});

describe('readNfceQr — decomposicao da chave', () => {
    // ESTE e o teste que existe por causa da tabela errada que circulou. Se
    // alguem reescrever os offsets a partir dela, serie vira '526' e nNF vira
    // 510100037, e e aqui que isso para.
    it('extrai CNPJ, serie e numero nas posicoes certas', () => {
        const r = readNfceQr(URL_ONLINE);

        expect(r.errors).toEqual([]);
        expect(r.cnpj).toBe('60479680001252');
        expect(r.serie).toBe('101');
        expect(r.nNF).toBe(371116);
    });

    it('devolve nNF como numero, sem os zeros a esquerda', () => {
        // String faria conversao implicita no Oracle e descartaria o indice.
        const r = readNfceQr(KEY_ONLINE);

        expect(typeof r.nNF).toBe('number');
        expect(r.nNF).toBe(371116);
    });

    it('le ano e mes da chave', () => {
        const r = readNfceQr(KEY_ONLINE);

        expect(r.emissionYear).toBe(2026);
        expect(r.emissionMonth).toBe(8);
    });

    it('nao inventa o dia no cupom normal', () => {
        // A chave so tem AAMM. E a razao de a regra "cupom de hoje" depender do
        // dtamovimento do Consinco em vez do QR.
        expect(readNfceQr(URL_ONLINE).qrDay).toBeNull();
    });
});

describe('readNfceQr — os dois layouts do parametro p', () => {
    it('reconhece o layout normal de 5 campos', () => {
        const r = readNfceQr(URL_ONLINE);

        expect(r.layout).toBe(QR_LAYOUT.ONLINE);
        expect(r.tpEmis).toBe('1');
        expect(r.isContingency).toBe(false);
    });

    it('reconhece a contingencia de 8 campos e le o dia e o valor', () => {
        const r = readNfceQr(URL_CONTINGENCY);

        expect(r.errors).toEqual([]);
        expect(r.layout).toBe(QR_LAYOUT.CONTINGENCY);
        expect(r.tpEmis).toBe('9');
        expect(r.isContingency).toBe(true);
        expect(r.qrDay).toBe(26);
        expect(r.qrTotal).toBe('261.00');
        expect(r.serie).toBe('107');
        expect(r.nNF).toBe(384153);
    });
});

describe('readNfceQr — formatos de entrada aceitos', () => {
    it('aceita a URL inteira, o p sozinho e a chave nua', () => {
        const key = readNfceQr(KEY_ONLINE).key;

        expect(readNfceQr(URL_ONLINE).key).toBe(key);
        expect(readNfceQr(`${KEY_ONLINE}|2|1|1|ABC`).key).toBe(key);
        expect(key).toBe(KEY_ONLINE);
    });

    it('aceita p percent-encoded', () => {
        const encoded =
            `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY_ONLINE}%7C2%7C1%7C1%7CABC`;

        const r = readNfceQr(encoded);

        expect(r.key).toBe(KEY_ONLINE);
        expect(r.layout).toBe(QR_LAYOUT.ONLINE);
    });

    it('ignora espaco em volta', () => {
        expect(readNfceQr(`  ${KEY_ONLINE}  `).key).toBe(KEY_ONLINE);
    });
});

describe('readNfceQr — recusas', () => {
    it('recusa entrada vazia', () => {
        for (const input of ['', '   ', null, undefined]) {
            expect(readNfceQr(input).errors.join(' ')).toMatch(/Nenhum código lido/);
        }
    });

    it('recusa codigo que nao tem 44 digitos', () => {
        const r = readNfceQr('https://exemplo.com/qrcode?p=123456');

        expect(r.key).toBeNull();
        expect(r.errors.join(' ')).toMatch(/não é de um cupom fiscal/);
    });

    it('recusa cupom de outro estado', () => {
        // cUF 33 = RJ. Reconstroi um DV valido para isolar a checagem de UF.
        const body = `33${KEY_ONLINE.slice(2, 43)}`;
        const key = body + nfceCheckDigit(body);

        const r = readNfceQr(key);

        expect(r.errors.join(' ')).toMatch(/estado 33/);
    });

    it('recusa NF-e modelo 55', () => {
        const body = `${KEY_ONLINE.slice(0, 20)}55${KEY_ONLINE.slice(22, 43)}`;
        const key = body + nfceCheckDigit(body);

        const r = readNfceQr(key);

        expect(r.errors.join(' ')).toMatch(/modelo 55/);
    });

    it('recusa chave com digito verificador errado', () => {
        const wrongDv = KEY_ONLINE.slice(0, 43) + ((Number(KEY_ONLINE[43]) + 1) % 10);

        const r = readNfceQr(wrongDv);

        expect(r.errors.join(' ')).toMatch(/dígito verificador/);
        // A chave sai preenchida mesmo com erro: o chamador loga a tentativa.
        expect(r.key).toHaveLength(KEY_LENGTH);
    });

    it('nunca lanca', () => {
        for (const input of [{}, [], 0, NaN, '%%%', 'p=%E0%A4%A']) {
            expect(() => readNfceQr(input)).not.toThrow();
        }
    });
});
