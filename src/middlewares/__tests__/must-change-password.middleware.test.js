const { mustChangePassword } = require('../must-change-password.middleware');

function makeRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('mustChangePassword middleware', () => {
    it('deve liberar quem não tem troca pendente', () => {
        const next = jest.fn();
        const res = makeRes();

        mustChangePassword({ user: { id: 1, must_change_password: false }, path: '/epp/products' }, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('deve liberar requisição sem usuário — quem barra é o authMiddleware', () => {
        const next = jest.fn();
        mustChangePassword({ path: '/login' }, makeRes(), next);
        expect(next).toHaveBeenCalled();
    });

    it.each(['/me', '/change-password', '/logout'])(
        'deve liberar %s mesmo com troca pendente',
        path => {
            const next = jest.fn();
            const res = makeRes();

            mustChangePassword({ user: { must_change_password: true }, path }, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        },
    );

    it.each([
        '/epp/products',
        '/gtpp/tasks',
        '/access/users',
        '/time-records/payment',
        '/gipp-rh/payment-receipt',
    ])('deve bloquear %s com 403 quando a troca está pendente', path => {
        const next = jest.fn();
        const res = makeRes();

        mustChangePassword({ user: { must_change_password: true }, path }, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: true,
            code: 'MUST_CHANGE_PASSWORD',
        }));
    });

    it('não deve liberar caminho que apenas contém um permitido', () => {
        const next = jest.fn();
        const res = makeRes();

        // Comparação é exata: '/access/users/1/change-password' não é '/change-password'.
        mustChangePassword(
            { user: { must_change_password: true }, path: '/access/users/1/change-password' },
            res,
            next,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
