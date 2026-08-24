/**
 * O que estes testes garantem é a CHAVE de cada limiter — que é onde estava o
 * defeito de 24/08/2026: tudo era contado por IP, então quem dividia endereço
 * dividia a cota.
 */

const jwtService = require('../../infra/auth/jwt.service');
const {
    LIMITS,
    WINDOW_MS,
    ipKey,
    userKey,
    loginKey,
    changePasswordKey,
    resolveUserId,
    isAuthenticated,
    isAnonymous,
} = require('../rate-limit.middleware');

/** Requisição de mentira, no formato que os keyGenerators consomem. */
function fakeReq({ ip = '10.10.20.55', token, body } = {}) {
    return { ip, cookies: token ? { accessToken: token } : {}, body };
}

const tokenFor = id => jwtService.generateAccessToken({ id, name: 'Fulano' });

describe('resolveUserId', () => {
    it('devolve o id de um token válido', () => {
        expect(resolveUserId(fakeReq({ token: tokenFor(397) }))).toBe(397);
    });

    it('devolve null sem cookie', () => {
        expect(resolveUserId(fakeReq())).toBeNull();
    });

    it('devolve null para token forjado', () => {
        // O ponto central: se o token fosse apenas decodificado em vez de
        // verificado, bastaria inventar um id novo a cada requisição para ganhar
        // um balde limpo e furar o limite por usuário.
        const forjado = Buffer.from(JSON.stringify({ id: 999 })).toString('base64');
        expect(resolveUserId(fakeReq({ token: `x.${forjado}.y` }))).toBeNull();
    });

    it('devolve null para token assinado com outro segredo', () => {
        // É o caso real dos dois backends: o par de segredos do público é
        // diferente do interno, e um token de candidato não vale aqui.
        const outro = require('jsonwebtoken').sign({ id: 5 }, 'segredo-de-outro-backend');
        expect(resolveUserId(fakeReq({ token: outro }))).toBeNull();
    });

    it('memoiza — duas camadas de limiter leem o mesmo valor', () => {
        const req = fakeReq({ token: tokenFor(12) });
        const spy = jest.spyOn(jwtService, 'verifyAccessToken');

        resolveUserId(req);
        resolveUserId(req);
        isAuthenticated(req);

        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});

describe('as duas camadas são mutuamente exclusivas', () => {
    it('requisição autenticada só entra no userLimiter', () => {
        const req = fakeReq({ token: tokenFor(397) });

        expect(isAuthenticated(req)).toBe(true);  // sai do balde de IP (skip do apiLimiter)
        expect(isAnonymous(req)).toBe(false);     // entra no balde do usuário
    });

    it('requisição anônima só entra no apiLimiter', () => {
        const req = fakeReq();

        expect(isAuthenticated(req)).toBe(false);
        expect(isAnonymous(req)).toBe(true);
    });
});

describe('chave por usuário', () => {
    it('mesmo usuário em IPs diferentes compartilha o balde', () => {
        const token = tokenFor(397);
        const casa = fakeReq({ ip: '203.0.113.10', token });
        const loja = fakeReq({ ip: '10.10.20.55', token });

        expect(userKey(loja)).toBe(userKey(casa));
    });

    it('usuários diferentes no MESMO IP têm baldes separados', () => {
        // Este é o caso que quebrava: NAT do mobile e terminal compartilhado.
        const a = fakeReq({ ip: '10.10.20.55', token: tokenFor(397) });
        const b = fakeReq({ ip: '10.10.20.55', token: tokenFor(412) });

        expect(userKey(a)).not.toBe(userKey(b));
    });
});

describe('login', () => {
    const ip = '10.10.20.55';

    it('separa por usuário tentado no mesmo IP', () => {
        // Senha errada de um não pode travar o login do colega ao lado.
        const a = fakeReq({ ip, body: { username: 'joao' } });
        const b = fakeReq({ ip, body: { username: 'maria' } });

        expect(loginKey(a)).not.toBe(loginKey(b));
    });

    it('normaliza o username para não multiplicar baldes', () => {
        const a = fakeReq({ ip, body: { username: 'Joao' } });
        const b = fakeReq({ ip, body: { username: '  joao ' } });

        expect(loginKey(a)).toBe(loginKey(b));
    });

    it('mesmo usuário em IPs diferentes NÃO compartilha balde', () => {
        // Ao contrário do userLimiter: aqui separar é proteção contra alguém
        // trancar a conta de um colega de fora, errando a senha dele.
        const escritorio = fakeReq({ ip, body: { username: 'joao' } });
        const rua = fakeReq({ ip: '203.0.113.10', body: { username: 'joao' } });

        expect(loginKey(escritorio)).not.toBe(loginKey(rua));
    });

    it('cai para IP puro quando não há username (google-login)', () => {
        const semBody = fakeReq({ ip });
        expect(loginKey(semBody)).toBe(ipKey(semBody));
    });

    it('o teto por IP ignora qual conta foi tentada', () => {
        // Sem isto, trocar de conta a cada 10 tentativas seria balde novo à
        // vontade, e o limite por IP+usuário não conteria varredura de contas.
        const a = fakeReq({ ip, body: { username: 'joao' } });
        const b = fakeReq({ ip, body: { username: 'maria' } });

        expect(ipKey(a)).toBe(ipKey(b));
    });

    it('as cotas de login contam falhas, e são as duas camadas esperadas', () => {
        // `skipSuccessfulRequests` não é introspectável no middleware; o que dá
        // para fixar aqui são as cotas, e que o teto por IP é maior que o de
        // IP+usuário — senão a camada de baixo nunca disparava.
        expect(LIMITS.login).toBe(10);
        expect(LIMITS.loginIp).toBe(50);
        expect(LIMITS.loginIp).toBeGreaterThan(LIMITS.login);
    });
});

describe('troca de senha', () => {
    it('chaveia pelo usuário da sessão, não pelo terminal', () => {
        const ip = '10.10.20.55';
        const a = fakeReq({ ip, token: tokenFor(397) });
        const b = fakeReq({ ip, token: tokenFor(412) });

        expect(changePasswordKey(a)).not.toBe(changePasswordKey(b));
    });

    it('sem sessão, cai para IP', () => {
        const req = fakeReq();
        expect(changePasswordKey(req)).toBe(ipKey(req));
    });
});

describe('limites configurados', () => {
    it('o limiter que estrangulava o uso normal não conta mais tráfego com sessão', () => {
        // Era 200/IP contando TUDO, inclusive cada foto de colaborador.
        expect(LIMITS.ip).toBe(2000);
        expect(LIMITS.user).toBe(1000);
        expect(LIMITS.changePassword).toBe(5);
    });

    it('a janela é de 15 minutos', () => {
        expect(WINDOW_MS).toBe(15 * 60 * 1000);
    });
});
