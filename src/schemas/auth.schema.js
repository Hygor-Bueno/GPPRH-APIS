// Schemas de validação para rotas de autenticação

const loginSchema = {
    username: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    password: { type: 'string', required: true, minLength: 1, maxLength: 200 }
};

/**
 * Troca de senha própria. O id do usuário vem do token, nunca do body —
 * aceitar `user_id` aqui permitiria trocar a senha de terceiros.
 */
const changePasswordSchema = {
    current_password: { type: 'string', required: true, minLength: 1,  maxLength: 200 },
    new_password:     { type: 'string', required: true, minLength: 8,  maxLength: 200 }
};

module.exports = { loginSchema, changePasswordSchema };
