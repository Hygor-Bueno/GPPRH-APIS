const {
    ipInCidr, normalizeBaseUrl, normalizeDevice, assertRepNumberChange, parseAllowedNetworks, DEFAULT_ALLOWED_NETWORKS,
} = require('../device/device.rules');

const NETS = DEFAULT_ALLOWED_NETWORKS;

describe('normalizeBaseUrl — cada relógio com seu IP, só na rede interna', () => {
    test('aceita IP solto, com esquema, com barra e com porta', () => {
        expect(normalizeBaseUrl('192.168.10.28', NETS)).toBe('https://192.168.10.28');
        expect(normalizeBaseUrl('https://192.168.10.28/', NETS)).toBe('https://192.168.10.28');
        expect(normalizeBaseUrl('192.168.20.5:8443', NETS)).toBe('https://192.168.20.5:8443');
        expect(normalizeBaseUrl('http://10.1.2.3', NETS)).toBe('http://10.1.2.3');
    });

    test('recusa nome de host — DNS pode apontar para fora depois', () => {
        expect(() => normalizeBaseUrl('relogio.empresa.com.br', NETS)).toThrow(/IP/);
    });

    test('recusa IP fora das redes permitidas — a senha compartilhada iria para lá', () => {
        expect(() => normalizeBaseUrl('8.8.8.8', NETS)).toThrow(/fora das redes/);
        expect(() => normalizeBaseUrl('192.168.10.28', ['10.0.0.0/8'])).toThrow(/fora das redes/);
    });

    test('recusa caminho, credencial na URL e esquema estranho', () => {
        expect(() => normalizeBaseUrl('https://192.168.10.28/login.fcgi', NETS)).toThrow(/sem caminho/);
        expect(() => normalizeBaseUrl('https://admin:x@192.168.10.28', NETS)).toThrow(/usuário ou senha/);
        expect(() => normalizeBaseUrl('ftp://192.168.10.28', NETS)).toThrow(/http/);
        expect(() => normalizeBaseUrl('', NETS)).toThrow(/IP/);
    });
});

describe('ipInCidr', () => {
    test('faixas', () => {
        expect(ipInCidr('192.168.10.28', '192.168.0.0/16')).toBe(true);
        expect(ipInCidr('192.169.0.1', '192.168.0.0/16')).toBe(false);
        expect(ipInCidr('172.31.255.255', '172.16.0.0/12')).toBe(true);
        expect(ipInCidr('172.32.0.1', '172.16.0.0/12')).toBe(false);
        expect(ipInCidr('192.168.10.28', '192.168.10.28/32')).toBe(true);
        expect(ipInCidr('999.1.1.1', '0.0.0.0/0')).toBe(false);
    });

    test('lista do .env, com padrão quando vazia', () => {
        expect(parseAllowedNetworks(' 192.168.10.0/24 , 10.0.0.0/8 ')).toEqual(['192.168.10.0/24', '10.0.0.0/8']);
        expect(parseAllowedNetworks('')).toEqual([...NETS]);
    });
});

describe('normalizeDevice', () => {
    const options = { allowedNetworks: NETS };

    test('cadastro completo, código em maiúsculas', () => {
        expect(normalizeDevice({ code: 'loja_02', name: 'REP-C Loja 2', base_url: '192.168.20.15' }, { ...options, creating: true }))
            .toEqual({ code: 'LOJA_02', name: 'REP-C Loja 2', baseUrl: 'https://192.168.20.15' });
    });

    test('edição parcial: só o IP', () => {
        expect(normalizeDevice({ base_url: '192.168.20.99' }, { ...options, creating: false })).toEqual({ baseUrl: 'https://192.168.20.99' });
    });

    test('código não muda depois de criado', () => {
        expect(() => normalizeDevice({ code: 'OUTRO' }, { ...options, creating: false })).toThrow(/não muda/);
    });

    test('REP de 17 dígitos, ou vazio', () => {
        expect(normalizeDevice({ rep_number: '' }, { ...options, creating: false })).toEqual({ repNumber: null });
        expect(() => normalizeDevice({ rep_number: '123' }, { ...options, creating: false })).toThrow(/17 dígitos/);
    });

    test('edição vazia é 400', () => {
        expect(() => normalizeDevice({}, { ...options, creating: false })).toThrow(/Nada para alterar/);
    });
});

describe('assertRepNumberChange — outro equipamento é outro cadastro', () => {
    test('trocar REP de relógio que já tem registros é 409', () => {
        expect(() => assertRepNumberChange({ current: '00014003750384563', next: '99999999999999999', hasRecords: true }))
            .toThrow(expect.objectContaining({ statusCode: 409 }));
    });
    test('preencher REP vazio, ou trocar antes da primeira carga, pode', () => {
        expect(() => assertRepNumberChange({ current: null, next: '00014003750384563', hasRecords: true })).not.toThrow();
        expect(() => assertRepNumberChange({ current: '00014003750384563', next: '99999999999999999', hasRecords: false })).not.toThrow();
    });
});
