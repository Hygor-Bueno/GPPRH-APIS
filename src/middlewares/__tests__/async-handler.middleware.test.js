const { asyncHandler } = require('../async-handler.middleware');

describe('asyncHandler', () => {
    it('should call the handler normally when no error', async () => {
        const handler = jest.fn().mockResolvedValue('ok');
        const wrapped = asyncHandler(handler);

        const req = {};
        const res = {};
        const next = jest.fn();

        await wrapped(req, res, next);

        expect(handler).toHaveBeenCalledWith(req, res, next);
        expect(next).not.toHaveBeenCalled();
    });

    it('should call next(err) when handler throws synchronously', async () => {
        const error = new Error('sync error');
        const handler = jest.fn().mockImplementation(() => { throw error; });
        const wrapped = asyncHandler(handler);

        const next = jest.fn();
        await wrapped({}, {}, next);

        expect(next).toHaveBeenCalledWith(error);
    });

    it('should call next(err) when handler rejects a promise', async () => {
        const error = new Error('async error');
        const handler = jest.fn().mockRejectedValue(error);
        const wrapped = asyncHandler(handler);

        const next = jest.fn();
        await wrapped({}, {}, next);

        expect(next).toHaveBeenCalledWith(error);
    });

    it('should pass req, res, next correctly to the handler', async () => {
        const handler = jest.fn().mockResolvedValue(undefined);
        const wrapped = asyncHandler(handler);

        const req = { body: { test: true } };
        const res = { status: jest.fn() };
        const next = jest.fn();

        await wrapped(req, res, next);

        expect(handler).toHaveBeenCalledWith(req, res, next);
    });
});
