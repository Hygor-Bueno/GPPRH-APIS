const { errorHandler } = require('../error.middleware');
const { AppError } = require('../../errors/app.error');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('errorHandler middleware', () => {
    const req = {};
    const next = jest.fn();

    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {}); // silencia console.error nos testes
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should respond with AppError status and message', () => {
        const res = mockRes();
        const err = new AppError('Not found', 404);

        errorHandler(err, req, res, next);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: true, message: 'Not found' })
        );
    });

    it('should respond with 500 for generic errors', () => {
        const res = mockRes();
        const err = new Error('Something broke');

        errorHandler(err, req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: true, message: 'Internal server error' })
        );
    });

    it('should not expose internal details for generic errors', () => {
        const res = mockRes();
        const err = new Error('DB password: secret123');

        errorHandler(err, req, res, next);

        const body = res.json.mock.calls[0][0];
        expect(body.message).toBe('Internal server error'); // mensagem genérica
        expect(JSON.stringify(body)).not.toContain('secret123'); // sem vazar detalhes
    });

    it('should include fields when AppError has fields', () => {
        const res = mockRes();
        const err = new AppError('Validation failed', 400);
        err.fields = ['name', 'email'];

        errorHandler(err, req, res, next);

        const body = res.json.mock.calls[0][0];
        expect(body.fields).toEqual(['name', 'email']);
    });
});
