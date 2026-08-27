const { validateSchema } = require('../../middlewares/validate.middleware');
const { createJobSchema, updateJobSchema, blockUnknownJobFields, validateSalaryRange } = require('../job.schema');

const validJob = {
    branch_cod:    '01',
    branch_name:   'Filial SP',
    position_cod:  'DEV01',
    position_name: 'Desenvolvedor',
    description:   'Descrição detalhada da vaga com pelo menos dez caracteres.',
    salary_min:    3000,
    salary_max:    5000,
    location:      'São Paulo'
};

describe('createJobSchema', () => {
    it('should pass with all valid fields', () => {
        const errors = validateSchema(validJob, createJobSchema);
        expect(errors).toHaveLength(0);
    });

    it('should fail when required fields are missing', () => {
        const errors = validateSchema({}, createJobSchema);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors).toContain("O campo 'branch_cod' é obrigatório.");
        expect(errors).toContain("O campo 'description' é obrigatório.");
        expect(errors).toContain("O campo 'salary_min' é obrigatório.");
    });

    it('should fail when description is too short', () => {
        const errors = validateSchema(
            { ...validJob, description: 'curta' },
            createJobSchema
        );
        expect(errors).toContain("O campo 'description' deve ter no mínimo 10 caracteres.");
    });

    it('should fail when salary_min is negative', () => {
        const errors = validateSchema(
            { ...validJob, salary_min: -100 },
            createJobSchema
        );
        expect(errors).toContain("O campo 'salary_min' deve ser no mínimo 0.");
    });

    it('should coerce a numeric string into a number', () => {
        // Coerção deliberada do middleware: o formulário manda "3000".
        const data = { ...validJob, salary_min: '3000' };
        expect(validateSchema(data, createJobSchema)).toEqual([]);
        expect(data.salary_min).toBe(3000);
    });

    it('should fail when salary_min is not numeric at all', () => {
        const errors = validateSchema(
            { ...validJob, salary_min: 'três mil' },
            createJobSchema
        );
        expect(errors).toContain("O campo 'salary_min' deve ser um número.");
    });
});

describe('updateJobSchema', () => {
    it('should require id', () => {
        const errors = validateSchema({ position_name: 'Dev' }, updateJobSchema);
        expect(errors).toContain("O campo 'id' é obrigatório.");
    });

    it('should pass with only id and one field', () => {
        const errors = validateSchema({ id: 1, position_name: 'Dev Jr' }, updateJobSchema);
        expect(errors).toHaveLength(0);
    });
});

describe('blockUnknownJobFields middleware', () => {
    function mockNext() { return jest.fn(); }

    it('should pass when all fields are known', () => {
        const req = { body: { branch_cod: '01', position_name: 'Dev', salary_min: 1000 } };
        const next = mockNext();

        blockUnknownJobFields(req, {}, next);

        expect(next).toHaveBeenCalledWith();
    });

    it('should pass when body is empty', () => {
        const req = { body: {} };
        const next = mockNext();

        blockUnknownJobFields(req, {}, next);

        expect(next).toHaveBeenCalledWith();
    });

    it('should fail when body contains unknown fields', () => {
        const req = { body: { branch_cod: '01', hacker_field: 'x' } };
        const next = mockNext();

        blockUnknownJobFields(req, {}, next);

        const err = next.mock.calls[0][0];
        expect(err).toBeDefined();
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('hacker_field');
    });

    it('should list all unknown fields in the error message', () => {
        const req = { body: { foo: 1, bar: 2 } };
        const next = mockNext();

        blockUnknownJobFields(req, {}, next);

        const err = next.mock.calls[0][0];
        expect(err.message).toContain('foo');
        expect(err.message).toContain('bar');
    });

    it('should handle missing body gracefully', () => {
        const req = {};
        const next = mockNext();

        blockUnknownJobFields(req, {}, next);

        expect(next).toHaveBeenCalledWith();
    });
});

describe('validateSalaryRange middleware', () => {
    function mockNext() { return jest.fn(); }

    it('should pass when salary_min <= salary_max', () => {
        const req = { body: { salary_min: 3000, salary_max: 5000 } };
        const next = mockNext();

        validateSalaryRange(req, {}, next);

        expect(next).toHaveBeenCalledWith(); // sem erro
    });

    it('should pass when salary_min === salary_max', () => {
        const req = { body: { salary_min: 3000, salary_max: 3000 } };
        const next = mockNext();

        validateSalaryRange(req, {}, next);

        expect(next).toHaveBeenCalledWith();
    });

    it('should fail when salary_min > salary_max', () => {
        const req = { body: { salary_min: 6000, salary_max: 4000 } };
        const next = mockNext();

        validateSalaryRange(req, {}, next);

        const err = next.mock.calls[0][0];
        expect(err).toBeDefined();
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('salary_min');
    });

    it('should skip when salary fields are absent', () => {
        const req = { body: { position_name: 'Dev' } };
        const next = mockNext();

        validateSalaryRange(req, {}, next);

        expect(next).toHaveBeenCalledWith();
    });
});
