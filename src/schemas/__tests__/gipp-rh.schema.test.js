const { validateSchema } = require('../../middlewares/validate.middleware');
const {
    postCompensationSchema,
    putCompensationSchema,
    postBeneficiarySchema,
    putBeneficiarySchema,
    getReceiptQuerySchema
} = require('../gipp-rh.schema');

// ---------------------------------------------------------------------------
// postCompensationSchema
// ---------------------------------------------------------------------------
describe('postCompensationSchema', () => {
    const valid = { name: 'Vale Transporte', description: 'Benefício de transporte', active: true };

    it('should pass with all valid fields', () => {
        expect(validateSchema(valid, postCompensationSchema)).toHaveLength(0);
    });

    it('should fail when required fields are missing', () => {
        const errors = validateSchema({}, postCompensationSchema);
        expect(errors).toContain("O campo 'name' é obrigatório.");
        expect(errors).toContain("O campo 'description' é obrigatório.");
        expect(errors).toContain("O campo 'active' é obrigatório.");
    });

    it('should fail when name is not a string', () => {
        const errors = validateSchema({ ...valid, name: 123 }, postCompensationSchema);
        expect(errors).toContain("O campo 'name' deve ser um texto.");
    });

    it('should fail when name exceeds maxLength', () => {
        const errors = validateSchema({ ...valid, name: 'a'.repeat(201) }, postCompensationSchema);
        expect(errors).toContain("O campo 'name' deve ter no máximo 200 caracteres.");
    });

    it('should fail when description exceeds maxLength', () => {
        const errors = validateSchema({ ...valid, description: 'x'.repeat(501) }, postCompensationSchema);
        expect(errors).toContain("O campo 'description' deve ter no máximo 500 caracteres.");
    });

    it('should accept "true" as a string and coerce it', () => {
        // O middleware coage "true"/"false" — ver validate.middleware.
        const data = { ...valid, active: 'true' };
        expect(validateSchema(data, postCompensationSchema)).toEqual([]);
        expect(data.active).toBe(true);
    });

    it('should fail when active is a string that is not boolean-like', () => {
        const errors = validateSchema({ ...valid, active: 'sim' }, postCompensationSchema);
        expect(errors).toContain("O campo 'active' deve ser verdadeiro ou falso.");
    });
});

// ---------------------------------------------------------------------------
// putCompensationSchema
// ---------------------------------------------------------------------------
describe('putCompensationSchema', () => {
    const valid = { id: 1, name: 'Vale Transporte', description: 'Benefício de transporte', active: false };

    it('should pass with all valid fields', () => {
        expect(validateSchema(valid, putCompensationSchema)).toHaveLength(0);
    });

    it('should fail when id is missing', () => {
        const errors = validateSchema({ name: 'Vale', description: 'Desc', active: true }, putCompensationSchema);
        expect(errors).toContain("O campo 'id' é obrigatório.");
    });

    it('should fail when id is not a number', () => {
        const errors = validateSchema({ ...valid, id: 'abc' }, putCompensationSchema);
        expect(errors).toContain("O campo 'id' deve ser um número.");
    });
});

// ---------------------------------------------------------------------------
// postBeneficiarySchema
// ---------------------------------------------------------------------------
describe('postBeneficiarySchema', () => {
    const valid = {
        employee_id:     'E001',
        compensation_id: 2,
        value:           500,
        branch_code:     '01',
        start_date:      '2024-01-15'
    };

    it('should pass with all valid fields', () => {
        expect(validateSchema(valid, postBeneficiarySchema)).toHaveLength(0);
    });

    it('should fail when required fields are missing', () => {
        const errors = validateSchema({}, postBeneficiarySchema);
        expect(errors).toContain("O campo 'employee_id' é obrigatório.");
        expect(errors).toContain("O campo 'compensation_id' é obrigatório.");
        expect(errors).toContain("O campo 'value' é obrigatório.");
        expect(errors).toContain("O campo 'branch_code' é obrigatório.");
        expect(errors).toContain("O campo 'start_date' é obrigatório.");
    });

    it('should fail when compensation_id is below min', () => {
        const errors = validateSchema({ ...valid, compensation_id: 0 }, postBeneficiarySchema);
        expect(errors).toContain("O campo 'compensation_id' deve ser no mínimo 1.");
    });

    it('should fail when value is negative', () => {
        const errors = validateSchema({ ...valid, value: -1 }, postBeneficiarySchema);
        expect(errors).toContain("O campo 'value' deve ser no mínimo 0.");
    });

    it('should fail when start_date has wrong format', () => {
        const errors = validateSchema({ ...valid, start_date: '15/01/2024' }, postBeneficiarySchema);
        expect(errors).toContain("O campo 'start_date' está em formato inválido.");
    });

    it('should fail when start_date is not YYYY-MM-DD', () => {
        const errors = validateSchema({ ...valid, start_date: '20240115' }, postBeneficiarySchema);
        expect(errors).toContain("O campo 'start_date' está em formato inválido.");
    });

    it('should pass with value = 0 (zero is allowed)', () => {
        expect(validateSchema({ ...valid, value: 0 }, postBeneficiarySchema)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// putBeneficiarySchema
// ---------------------------------------------------------------------------
describe('putBeneficiarySchema', () => {
    const valid = {
        id:              10,
        employee_id:     'E001',
        compensation_id: 2,
        value:           500,
        branch_code:     '01',
        start_date:      '2024-06-01'
    };

    it('should pass with all valid fields', () => {
        expect(validateSchema(valid, putBeneficiarySchema)).toHaveLength(0);
    });

    it('should fail when id is missing', () => {
        const { id, ...without } = valid;
        const errors = validateSchema(without, putBeneficiarySchema);
        expect(errors).toContain("O campo 'id' é obrigatório.");
    });

    it('should fail when start_date format is wrong', () => {
        const errors = validateSchema({ ...valid, start_date: '2024/06/01' }, putBeneficiarySchema);
        expect(errors).toContain("O campo 'start_date' está em formato inválido.");
    });
});

// ---------------------------------------------------------------------------
// getReceiptQuerySchema
// ---------------------------------------------------------------------------
describe('getReceiptQuerySchema', () => {
    it('should pass with a valid 6-digit reference', () => {
        expect(validateSchema({ reference: '202401' }, getReceiptQuerySchema)).toHaveLength(0);
    });

    it('should fail when reference is missing', () => {
        const errors = validateSchema({}, getReceiptQuerySchema);
        expect(errors).toContain("O campo 'reference' é obrigatório.");
    });

    it('should fail when reference has fewer than 6 digits', () => {
        const errors = validateSchema({ reference: '2024' }, getReceiptQuerySchema);
        expect(errors).toContain("O campo 'reference' está em formato inválido.");
    });

    it('should fail when reference has more than 6 digits', () => {
        const errors = validateSchema({ reference: '2024010' }, getReceiptQuerySchema);
        expect(errors).toContain("O campo 'reference' está em formato inválido.");
    });

    it('should fail when reference contains non-numeric characters', () => {
        const errors = validateSchema({ reference: '2024AB' }, getReceiptQuerySchema);
        expect(errors).toContain("O campo 'reference' está em formato inválido.");
    });

    it('should fail when reference is a number instead of string', () => {
        const errors = validateSchema({ reference: 202401 }, getReceiptQuerySchema);
        expect(errors).toContain("O campo 'reference' deve ser um texto.");
    });
});
