const { validateSchema } = require('../../middlewares/validate.middleware');
const { loginSchema } = require('../auth.schema');

describe('loginSchema', () => {
    it('should pass with valid username and password', () => {
        const errors = validateSchema({ username: 'john', password: 'secret' }, loginSchema);
        expect(errors).toHaveLength(0);
    });

    it('should fail when username is missing', () => {
        const errors = validateSchema({ password: 'secret' }, loginSchema);
        expect(errors).toContain("'username' is required");
    });

    it('should fail when password is missing', () => {
        const errors = validateSchema({ username: 'john' }, loginSchema);
        expect(errors).toContain("'password' is required");
    });

    it('should fail when both fields are missing', () => {
        const errors = validateSchema({}, loginSchema);
        expect(errors).toHaveLength(2);
    });

    it('should fail when username exceeds maxLength', () => {
        const errors = validateSchema(
            { username: 'a'.repeat(101), password: 'secret' },
            loginSchema
        );
        expect(errors).toContain("'username' must be at most 100 characters");
    });

    it('should fail when password exceeds maxLength', () => {
        const errors = validateSchema(
            { username: 'john', password: 'x'.repeat(201) },
            loginSchema
        );
        expect(errors).toContain("'password' must be at most 200 characters");
    });

    it('should fail when username is not a string', () => {
        const errors = validateSchema({ username: 123, password: 'secret' }, loginSchema);
        expect(errors).toContain("'username' must be a string");
    });
});
