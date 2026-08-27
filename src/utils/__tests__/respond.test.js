const { respond } = require('../respond');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('respond helper', () => {
    describe('respond.ok', () => {
        it('should return 200 with error: false and data', () => {
            const res = mockRes();
            respond.ok(res, { name: 'test' });

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                error: false,
                data: { name: 'test' }
            });
        });

        it('should handle array data', () => {
            const res = mockRes();
            respond.ok(res, [1, 2, 3]);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                error: false,
                data: [1, 2, 3]
            });
        });

        it('should handle null data', () => {
            const res = mockRes();
            respond.ok(res, null);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ error: false, data: null });
        });
    });

    describe('respond.created', () => {
        it('should return 201 with error: false and data', () => {
            const res = mockRes();
            respond.created(res, { insertId: 42 });

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                error: false,
                data: { insertId: 42 }
            });
        });
    });

    describe('respond.message', () => {
        it('should return 200 with error: false and message', () => {
            const res = mockRes();
            respond.message(res, 'Done');

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                error: false,
                message: 'Done'
            });
        });

        it('should support custom status code', () => {
            const res = mockRes();
            respond.message(res, 'Created', 201);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                error: false,
                message: 'Created'
            });
        });
    });
});
