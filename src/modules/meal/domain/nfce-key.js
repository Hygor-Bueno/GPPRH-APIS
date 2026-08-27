/**
 * @fileoverview Domínio — a chave de acesso da NFC-e e o QR Code que a carrega.
 *
 * Puro: não conhece banco, não conhece Express. Recebe o texto que o leitor
 * devolveu e diz o que ele é. Tudo que sai daqui já está conferido o suficiente
 * para virar bind de query.
 *
 * ⚠️ **As posições daqui não são negociáveis, e o motivo é uma tabela errada.**
 * A documentação interna que circulou lista o CNPJ em 07–16 e o `cNF` com 12
 * dígitos. Somando aquela coluna dá 48, e a chave tem 44. Quem escreve o
 * `slice` a partir dela extrai `526` como série e `510100037` como número, a
 * query não acha nada, e o sintoma é "cupom não encontrado" para TODO cupom
 * válido — o pior tipo de bug, porque parece regra de negócio funcionando.
 *
 * O layout abaixo foi conferido dígito a dígito contra duas chaves reais de
 * produção, uma normal e uma em contingência, e o dígito verificador fecha nas
 * duas. Ver `__tests__/nfce-key.test.js`.
 *
 * @module modules/meal/domain/nfce-key
 */

/**
 * Onde cada campo mora na chave, em índice de `slice` (base zero).
 *
 * A numeração de `slice` NUNCA coincide com a numeração de posição do manual
 * fiscal (base um), e é exatamente aí que o erro reaparece a cada reescrita.
 * Por isso a tabela existe uma vez só, aqui, e ninguém recorta a chave à mão em
 * outro arquivo.
 *
 * Posição no manual │ slice      │ campo
 *   01 a 02         │  [ 0,  2]  │ cUF
 *   03 a 06         │  [ 2,  6]  │ AAMM
 *   07 a 20         │  [ 6, 20]  │ CNPJ
 *   21 a 22         │  [20, 22]  │ mod
 *   23 a 25         │  [22, 25]  │ série
 *   26 a 34         │  [25, 34]  │ nNF
 *   35              │  [34, 35]  │ tpEmis
 *   36 a 43         │  [35, 43]  │ cNF
 *   44              │  [43, 44]  │ cDV
 */
const FIELDS = Object.freeze({
    cUF:    Object.freeze([0, 2]),
    aamm:   Object.freeze([2, 6]),
    cnpj:   Object.freeze([6, 20]),
    mod:    Object.freeze([20, 22]),
    serie:  Object.freeze([22, 25]),
    nNF:    Object.freeze([25, 34]),
    tpEmis: Object.freeze([34, 35]),
    cNF:    Object.freeze([35, 43]),
    cDV:    Object.freeze([43, 44]),
});

const KEY_LENGTH = 44;

/** São Paulo. A empresa não opera fora do estado; QR de outra UF é engano ou teste. */
const EXPECTED_CUF = '35';

/** 65 é NFC-e. 55 é NF-e — nota de mercadoria não é cupom de consumidor. */
const EXPECTED_MOD = '65';

/** `tpEmis = 9`: emitida offline, pode ainda não ter sido transmitida à SEFAZ. */
const TP_EMIS_CONTINGENCY = '9';

/** Layout do parâmetro `p`, deduzido da contagem de campos. */
const QR_LAYOUT = Object.freeze({
    ONLINE: 'online',           // chNFe|nVersao|tpAmb|cIdToken|cHashQRCode
    CONTINGENCY: 'contingency', // chNFe|nVersao|tpAmb|dia|vNF|digVal|cIdToken|cHashQRCode
    UNKNOWN: 'unknown',
});

const QR_FIELD_COUNT = Object.freeze({ ONLINE: 5, CONTINGENCY: 8 });

/**
 * Dígito verificador da chave — módulo 11, pesos 2 a 9 cíclicos da direita
 * para a esquerda.
 *
 * Roda em microssegundos e derruba chave digitada errada e QR arranhado antes
 * de qualquer ida ao Oracle. Não prova que a nota existe — prova que a sequência
 * de 44 dígitos é internamente coerente, que é outra coisa e vem primeiro.
 *
 * @param {string} first43 - Os 43 primeiros dígitos da chave.
 * @returns {number} O dígito esperado, 0 a 9.
 */
function nfceCheckDigit(first43) {
    let sum = 0;
    let weight = 2;

    for (let i = first43.length - 1; i >= 0; i -= 1) {
        sum += Number(first43[i]) * weight;
        weight = weight === 9 ? 2 : weight + 1;
    }

    const rest = sum % 11;

    /* Resto 0 e resto 1 caem no mesmo dígito por definição do algoritmo: 11-0 e
       11-1 dariam 11 e 10, que não cabem em uma casa. */
    return rest === 0 || rest === 1 ? 0 : 11 - rest;
}

/**
 * Separa o parâmetro `p` do que o leitor devolveu.
 *
 * Aceita a URL inteira, o valor de `p` sozinho, ou a chave nua. O leitor do
 * aparelho devolve a URL completa; a digitação manual devolve só os 44 dígitos;
 * e um teste com `curl` costuma mandar o `p` recortado. Os três chegam aqui, e
 * fazer o cliente adivinhar qual mandar seria empurrar o parse para cada tela.
 *
 * @param {string} input
 * @returns {string[]} Campos do `p`, separados por `|`. Vazio se não houver nada.
 */
function splitQrPayload(input) {
    const raw = String(input ?? '').trim();
    if (!raw) return [];

    /* `p` pode vir cru (`p=35...|2|1`) ou percent-encoded (`p=35...%7C2%7C1`),
       dependendo de quem montou o QR. Os dois são legítimos. */
    const fromUrl = raw.match(/[?&]p=([^&\s]+)/i);
    let payload = fromUrl ? fromUrl[1] : raw;

    if (payload.includes('%')) {
        try {
            payload = decodeURIComponent(payload);
        } catch {
            /* percent-encoding quebrado: segue com o texto original e deixa a
               validação da chave reclamar com mensagem melhor que "URI malformed". */
        }
    }

    return payload.split('|').map(part => part.trim());
}

/**
 * Lê o QR Code de uma NFC-e.
 *
 * Nunca lança. Devolve sempre o mesmo formato, com `errors` vazio quando a
 * chave é utilizável — o chamador decide o que fazer com a lista, do mesmo jeito
 * que `validateMealLog` já faz no registro de refeição.
 *
 * O que ele NÃO faz: conferir o `cHashQRCode`. Validar o hash exige o CSC, que é
 * segredo fiscal, e guardá-lo num serviço de refeitório aumenta a superfície de
 * exposição para confirmar algo que o Consinco confirma melhor. Se o documento
 * está no ERP, ele existe.
 *
 * @param {string} input - URL do QR, valor de `p`, ou a chave de 44 dígitos.
 * @returns {{
 *   errors: string[], key: string|null, cnpj: string|null,
 *   serie: string|null, nNF: number|null, tpEmis: string|null,
 *   isContingency: boolean, layout: string,
 *   emissionYear: number|null, emissionMonth: number|null, qrDay: number|null,
 *   qrTotal: string|null
 * }}
 */
function readNfceQr(input) {
    const empty = {
        errors: [],
        key: null,
        cnpj: null,
        serie: null,
        nNF: null,
        tpEmis: null,
        isContingency: false,
        layout: QR_LAYOUT.UNKNOWN,
        emissionYear: null,
        emissionMonth: null,
        qrDay: null,
        qrTotal: null,
    };

    const parts = splitQrPayload(input);

    if (parts.length === 0 || !parts[0]) {
        return { ...empty, errors: ['Nenhum código lido. Aproxime o QR Code do cupom.'] };
    }

    const key = parts[0].replace(/\D/g, '');

    if (key.length !== KEY_LENGTH) {
        return {
            ...empty,
            errors: [
                `A chave lida tem ${key.length} dígitos e a chave da NFC-e tem ${KEY_LENGTH}. ` +
                'Esse código não é de um cupom fiscal.',
            ],
        };
    }

    const slice = field => key.slice(FIELDS[field][0], FIELDS[field][1]);

    const cUF = slice('cUF');
    const aamm = slice('aamm');
    const cnpj = slice('cnpj');
    const mod = slice('mod');
    const serie = slice('serie');
    const nNF = slice('nNF');
    const tpEmis = slice('tpEmis');
    const cDV = slice('cDV');

    const errors = [];

    if (cUF !== EXPECTED_CUF) {
        errors.push(`O cupom é do estado ${cUF} e a loja é de São Paulo (${EXPECTED_CUF}).`);
    }

    if (mod !== EXPECTED_MOD) {
        errors.push(
            `O documento é do modelo ${mod}. Só cupom fiscal eletrônico (modelo ${EXPECTED_MOD}) libera almoço.`,
        );
    }

    if (Number(cDV) !== nfceCheckDigit(key.slice(0, KEY_LENGTH - 1))) {
        errors.push('A chave não confere com o próprio dígito verificador. Leia o QR Code de novo.');
    }

    /* O layout sai da CONTAGEM de campos, não do `tpEmis`: é a contagem que diz
       em qual índice está o hash, e indexar pelo layout errado lê o campo errado
       sem erro nenhum aparecer. */
    let layout = QR_LAYOUT.UNKNOWN;
    if (parts.length === QR_FIELD_COUNT.ONLINE) layout = QR_LAYOUT.ONLINE;
    else if (parts.length === QR_FIELD_COUNT.CONTINGENCY) layout = QR_LAYOUT.CONTINGENCY;

    const isContingency = tpEmis === TP_EMIS_CONTINGENCY;

    return {
        errors,
        key,
        cnpj,
        serie,
        /* Number() de propósito: `numerodf` no Consinco é numérico, e mandar
           '000371116' como string força conversão implícita no Oracle, que
           descarta o índice. Também resolve os zeros à esquerda. */
        nNF: Number(nNF),
        tpEmis,
        isContingency,
        layout,
        emissionYear: 2000 + Number(aamm.slice(0, 2)),
        emissionMonth: Number(aamm.slice(2, 4)),
        /* Só a contingência carrega o dia. O QR normal tem ano e mês e mais nada
           — é por isso que a validação de "cupom de hoje" depende do
           `dtamovimento` do Consinco e não pode sair daqui. */
        qrDay: layout === QR_LAYOUT.CONTINGENCY ? Number(parts[3]) : null,
        qrTotal: layout === QR_LAYOUT.CONTINGENCY ? parts[4] : null,
    };
}

module.exports = {
    readNfceQr,
    nfceCheckDigit,
    splitQrPayload,
    FIELDS,
    KEY_LENGTH,
    EXPECTED_CUF,
    EXPECTED_MOD,
    QR_LAYOUT,
};
