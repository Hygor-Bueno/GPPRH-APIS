const { validateSchema, validate } = require('../validate.middleware');

// ─── validateSchema (função pura) ────────────────────────────────────────────

describe('validateSchema', () => {
    describe('required', () => {
        it('should return error when required field is missing', () => {
            const errors = validateSchema({}, { name: { required: true } });
            expect(errors).toContain("O campo 'name' é obrigatório.");
        });

        it('should return error when required field is empty string', () => {
            const errors = validateSchema({ name: '' }, { name: { required: true } });
            expect(errors).toContain("O campo 'name' é obrigatório.");
        });

        it('should return error when required field is null', () => {
            const errors = validateSchema({ name: null }, { name: { required: true } });
            expect(errors).toContain("O campo 'name' é obrigatório.");
        });

        it('should pass when required field is present', () => {
            const errors = validateSchema({ name: 'John' }, { name: { required: true } });
            expect(errors).toHaveLength(0);
        });

        it('should skip optional missing field', () => {
            const errors = validateSchema({}, { age: { type: 'number', min: 0 } });
            expect(errors).toHaveLength(0);
        });
    });

    describe('type: string', () => {
        it('should return error when value is not a string', () => {
            const errors = validateSchema({ name: 123 }, { name: { type: 'string' } });
            expect(errors).toContain("O campo 'name' deve ser um texto.");
        });

        it('should pass when value is a string', () => {
            const errors = validateSchema({ name: 'hello' }, { name: { type: 'string' } });
            expect(errors).toHaveLength(0);
        });
    });

    describe('type: number', () => {
        it('should return error when value is not a number', () => {
            const errors = validateSchema({ age: 'abc' }, { age: { type: 'number' } });
            expect(errors).toContain("O campo 'age' deve ser um número.");
        });

        it('should return error when value is NaN', () => {
            const errors = validateSchema({ age: NaN }, { age: { type: 'number' } });
            expect(errors).toContain("O campo 'age' deve ser um número.");
        });

        it('should pass when value is a valid number', () => {
            const errors = validateSchema({ age: 25 }, { age: { type: 'number' } });
            expect(errors).toHaveLength(0);
        });
    });

    describe('type: boolean', () => {
        it('should return error when value is not a boolean', () => {
            const errors = validateSchema({ active: 'true' }, { active: { type: 'boolean' } });
            expect(errors).toContain("O campo 'active' deve ser verdadeiro ou falso.");
        });

        it('should pass for true', () => {
            const errors = validateSchema({ active: true }, { active: { type: 'boolean' } });
            expect(errors).toHaveLength(0);
        });

        it('should pass for false', () => {
            const errors = validateSchema({ active: false }, { active: { type: 'boolean' } });
            expect(errors).toHaveLength(0);
        });
    });

    describe('minLength / maxLength', () => {
        it('should return error when string is too short', () => {
            const errors = validateSchema({ name: 'ab' }, { name: { minLength: 3 } });
            expect(errors).toContain("O campo 'name' deve ter no mínimo 3 caracteres.");
        });

        it('should return error when string is too long', () => {
            const errors = validateSchema({ name: 'toolong' }, { name: { maxLength: 5 } });
            expect(errors).toContain("O campo 'name' deve ter no máximo 5 caracteres.");
        });

        it('should pass when within bounds', () => {
            const errors = validateSchema({ name: 'hello' }, { name: { minLength: 3, maxLength: 10 } });
            expect(errors).toHaveLength(0);
        });
    });

    describe('min / max', () => {
        it('should return error when number is below min', () => {
            const errors = validateSchema({ value: -1 }, { value: { type: 'number', min: 0 } });
            expect(errors).toContain("O campo 'value' deve ser no mínimo 0.");
        });

        it('should return error when number is above max', () => {
            const errors = validateSchema({ value: 101 }, { value: { type: 'number', max: 100 } });
            expect(errors).toContain("O campo 'value' deve ser no máximo 100.");
        });

        it('should pass when within range', () => {
            const errors = validateSchema({ value: 50 }, { value: { type: 'number', min: 0, max: 100 } });
            expect(errors).toHaveLength(0);
        });
    });

    describe('pattern', () => {
        it('should return error when pattern does not match', () => {
            const errors = validateSchema(
                { ref: 'ABCDEF' },
                { ref: { pattern: /^\d{6}$/ } }
            );
            expect(errors).toContain("O campo 'ref' está em formato inválido.");
        });

        it('should pass when pattern matches', () => {
            const errors = validateSchema(
                { ref: '202401' },
                { ref: { pattern: /^\d{6}$/ } }
            );
            expect(errors).toHaveLength(0);
        });
    });

    describe('enum', () => {
        it('should return error when value is not in enum', () => {
            const errors = validateSchema(
                { status: 'INVALID' },
                { status: { enum: ['OPEN', 'CLOSED'] } }
            );
            expect(errors).toContain("O campo 'status' deve ser um destes valores: OPEN, CLOSED");
        });

        it('should pass when value is in enum', () => {
            const errors = validateSchema(
                { status: 'OPEN' },
                { status: { enum: ['OPEN', 'CLOSED'] } }
            );
            expect(errors).toHaveLength(0);
        });
    });

    describe('multiple fields', () => {
        it('should accumulate all errors', () => {
            const errors = validateSchema(
                { name: '', age: 'abc' },
                {
                    name: { required: true },
                    age: { type: 'number' }
                }
            );
            expect(errors).toHaveLength(2);
        });
    });
});

// ─── validate middleware factory ──────────────────────────────────────────────

describe('validate middleware', () => {
    function mockReq(body = {}, query = {}, params = {}) {
        return { body, query, params };
    }

    function mockNext() {
        return jest.fn();
    }

    it('should call next() when validation passes', () => {
        const schema = { username: { required: true, type: 'string' } };
        const middleware = validate(schema);
        const req = mockReq({ username: 'john' });
        const next = mockNext();

        middleware(req, {}, next);

        expect(next).toHaveBeenCalledWith(); // called with no args = success
    });

    it('should call next(BadRequestError) when validation fails', () => {
        const schema = { username: { required: true } };
        const middleware = validate(schema);
        const req = mockReq({});
        const next = mockNext();

        middleware(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        const err = next.mock.calls[0][0];
        expect(err).toBeDefined();
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain("O campo 'username' é obrigatório.");
    });

    it('should validate query params when source is "query"', () => {
        const schema = { reference: { required: true, pattern: /^\d{6}$/ } };
        const middleware = validate(schema, 'query');
        const req = mockReq({}, { reference: 'invalid' });
        const next = mockNext();

        middleware(req, {}, next);

        const err = next.mock.calls[0][0];
        expect(err.statusCode).toBe(400);
    });

    it('should validate params when source is "params"', () => {
        const schema = { id: { required: true } };
        const middleware = validate(schema, 'params');
        const req = mockReq({}, {}, { id: '42' });
        const next = mockNext();

        middleware(req, {}, next);

        expect(next).toHaveBeenCalledWith(); // passes
    });
});
