const {
    toAuditActor,
    padCode,
    SYSTEM_ACTOR,
} = require('../audit-actor');

describe('padCode', () => {
    it('preserva zeros à esquerda que já vieram do banco global', () => {
        expect(padCode('002351', 6)).toBe('002351');
        expect(padCode('0202', 4)).toBe('0202');
    });

    it('completa com zeros quando o valor chega curto', () => {
        // Cenário real de risco: alguém grava a matrícula como número em algum
        // ponto da cadeia e ela chega '2351'. A coluna é VARCHAR(6) e uma
        // matrícula sem o zero aponta para outra pessoa no Protheus.
        expect(padCode('2351', 6)).toBe('002351');
        expect(padCode(2351, 6)).toBe('002351');
        expect(padCode(202, 4)).toBe('0202');
    });

    it('nunca devolve número — a coluna é VARCHAR', () => {
        expect(typeof padCode(2351, 6)).toBe('string');
    });

    it('não trunca valor maior que o esperado', () => {
        // Truncar inventaria um código válido apontando para outro cadastro.
        // Melhor o banco recusar do que gravar a pessoa errada.
        expect(padCode('1234567', 6)).toBe('1234567');
    });

    it('devolve null para ausência, e não string vazia', () => {
        // '' passaria por "preenchido" nas consultas de conferência.
        expect(padCode(null, 6)).toBeNull();
        expect(padCode(undefined, 6)).toBeNull();
        expect(padCode('', 6)).toBeNull();
        expect(padCode('   ', 6)).toBeNull();
    });
});

describe('toAuditActor', () => {
    const user = {
        id: 397,
        name: '  BERENILDO NOBERTO LINO  ',
        registration: '002351',
        branch_code: '0202',
        permissions: ['GIPP_APPROVE_TIMERECORD'],
    };

    it('extrai id, nome, matrícula e filial do usuário autenticado', () => {
        expect(toAuditActor(user)).toEqual({
            globalUserId: 397,
            name: 'BERENILDO NOBERTO LINO',
            registration: '002351',
            branchCode: '0202',
        });
    });

    it('não carrega nada além dos quatro campos de auditoria', () => {
        // Permissões e status não têm o que fazer numa trilha de auditoria, e
        // vazariam para o SESSION_CONTEXT se o objeto fosse repassado inteiro.
        expect(Object.keys(toAuditActor(user)).sort())
            .toEqual(['branchCode', 'globalUserId', 'name', 'registration']);
    });

    it('devolve o ator de sistema quando não há usuário', () => {
        expect(toAuditActor(null)).toBe(SYSTEM_ACTOR);
        expect(toAuditActor(undefined)).toBe(SYSTEM_ACTOR);
    });

    it('trata id não inteiro como ausente em vez de gravar NaN', () => {
        expect(toAuditActor({ ...user, id: 'abc' }).globalUserId).toBeNull();
        expect(toAuditActor({ ...user, id: undefined }).globalUserId).toBeNull();
    });

    it('sobrevive a usuário sem dados organizacionais', () => {
        // O portal de candidatos (gpprh) não tem matrícula nem filial. As
        // colunas aceitam NULL — o que não pode é estourar.
        expect(toAuditActor({ id: 12, name: 'Fulano' })).toEqual({
            globalUserId: 12,
            name: 'Fulano',
            registration: null,
            branchCode: null,
        });
    });

    it('o ator de sistema é congelado e compartilhado', () => {
        // Se fosse mutável, uma rotina que escrevesse nele contaminaria a
        // auditoria de todas as outras.
        expect(Object.isFrozen(SYSTEM_ACTOR)).toBe(true);
        expect(SYSTEM_ACTOR.globalUserId).toBeNull();
    });
});
