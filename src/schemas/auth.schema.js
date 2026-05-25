// Schemas de validação para rotas de autenticação

const loginSchema = {
    username: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    password: { type: 'string', required: true, minLength: 1, maxLength: 200 }
};

module.exports = { loginSchema };
