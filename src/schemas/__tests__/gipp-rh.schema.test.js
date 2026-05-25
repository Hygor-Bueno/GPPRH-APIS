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
        expect(errors).toContain("'name' is required");
        expect(errors).toContain("'description' is required");
        expect(errors).toContain("'active' is required");
    });

    it('should fail when name is not a string', () => {
        const errors = validateSchema({ ...valid, name: 123 }, postCompensationSchema);
        expect(errors).toContain("'name' must be a string");
    });

    it('should fail when name exceeds maxLength', () => {
        const errors = validateSchema({ ...valid, name: 'a'.repeat(201) }, postCompensationSchema);
        expect(errors).toContain("'name' must be at most 200 characters");
    });

    it('should fail when description exceeds maxLength', () => {
        const errors = validateSchema({ ...valid, description: 'x'.repeat(501) }, postCompensationSchema);
        expect(errors).toContain("'description' must be at most 500 characters");
    });

    it('should fail when active is not a boolean', () => {
        const errors = validateSchema({ ...valid, active: 'true' }, postCompensationSchema);
        expect(errors).toContain("'active' must be a boolean");
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
        expect(errors).toContain("'id' is required");
    });

    it('should fail when id is not a number', () => {
        const errors = validateSchema({ ...valid, id: 'abc' }, putCompensationSchema);
        expect(errors).toContain("'id' must be a number");
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
        expect(errors).toContain("'employee_id' is required");
        expect(errors).toContain("'compensation_id' is required");
        expect(errors).toContain("'value' is required");
        expect(errors).toContain("'branch_code' is required");
        expect(errors).toContain("'start_date' is required");
    });

    it('should fail when compensation_id is below min', () => {
        const errors = validateSchema({ ...valid, compensation_id: 0 }, postBeneficiarySchema);
        expect(errors).toContain("'compensation_id' must be at least 1");
    });

    it('should fail when value is negative', () => {
        const errors = validateSchema({ ...valid, value: -1 }, postBeneficiarySchema);
        expect(errors).toContain("'value' must be at least 0");
    });

    it('should fail when start_date has wrong format', () => {
        const errors = validateSchema({ ...valid, start_date: '15/01/2024' }, postBeneficiarySchema);
        expect(errors).toContain("'start_date' has an invalid format");
    });

    it('should fail when start_date is not YYYY-MM-DD', () => {
        const errors = validateSchema({ ...valid, start_date: '20240115' }, postBeneficiarySchema);
        expect(errors).toContain("'start_date' has an invalid format");
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
        expect(errors).toContain("'id' is required");
    });

    it('should fail when start_date format is wrong', () => {
        const errors = validateSchema({ ...valid, start_date: '2024/06/01' }, putBeneficiarySchema);
        expect(errors).toContain("'start_date' has an invalid format");
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
        expect(errors).toContain("'reference' is required");
    });

    it('should fail when reference has fewer than 6 digits', () => {
        const errors = validateSchema({ reference: '2024' }, getReceiptQuerySchema);
        expect(errors).toContain("'reference' has an invalid format");
    });

    it('should fail when reference has more than 6 digits', () => {
        const errors = validateSchema({ reference: '2024010' }, getReceiptQuerySchema);
        expect(errors).toContain("'reference' has an invalid format");
    });

    it('should fail when reference contains non-numeric characters', () => {
        const errors = validateSchema({ reference: '2024AB' }, getReceiptQuerySchema);
        expect(errors).toContain("'reference' has an invalid format");
    });

    it('should fail when reference is a number instead of string', () => {
        const errors = validateSchema({ reference: 202401 }, getReceiptQuerySchema);
        expect(errors).toContain("'reference' must be a string");
    });
});
