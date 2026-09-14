/**
 * @fileoverview Testes da matriz de permissão do painel meipp.
 */

const { hasAtLeast, canRead, canWrite, canAdminister } = require('../meipp-access.rules');
const { MeippRole } = require('../meipp.enums');

describe('hierarquia de papéis', () => {
    it('admin alcança os três patamares', () => {
        expect(canRead(MeippRole.ADMIN)).toBe(true);
        expect(canWrite(MeippRole.ADMIN)).toBe(true);
        expect(canAdminister(MeippRole.ADMIN)).toBe(true);
    });

    it('editor escreve mas não administra', () => {
        expect(canRead(MeippRole.EDITOR)).toBe(true);
        expect(canWrite(MeippRole.EDITOR)).toBe(true);
        expect(canAdminister(MeippRole.EDITOR)).toBe(false);
    });

    it('viewer só lê', () => {
        expect(canRead(MeippRole.VIEWER)).toBe(true);
        expect(canWrite(MeippRole.VIEWER)).toBe(false);
        expect(canAdminister(MeippRole.VIEWER)).toBe(false);
    });
});

describe('papel fora do ENUM', () => {
    // Cobre o caso de alguém editar `meipp_users.role` direto no banco: o
    // valor desconhecido não pode virar acesso.
    it.each([null, undefined, '', 'superadmin', 'ADMIN', 0, {}])(
        'não alcança nenhum patamar: %p',
        (role) => {
            expect(canRead(role)).toBe(false);
            expect(canWrite(role)).toBe(false);
            expect(canAdminister(role)).toBe(false);
        }
    );
});

describe('patamar mínimo inválido', () => {
    it('recusa quando o mínimo pedido não existe', () => {
        expect(hasAtLeast(MeippRole.ADMIN, 'inexistente')).toBe(false);
    });
});
