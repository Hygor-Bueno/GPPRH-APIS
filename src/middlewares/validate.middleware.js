const { BadRequestError } = require('../errors/bad-request.error');

/**
 * Valida um objeto contra um schema de regras.
 *
 * Regras suportadas por campo:
 *   required   {boolean}  - campo obrigatório
 *   type       {string}   - 'string' | 'number' | 'boolean'
 *   minLength  {number}   - tamanho mínimo (strings)
 *   maxLength  {number}   - tamanho máximo (strings)
 *   min        {number}   - valor mínimo (numbers)
 *   max        {number}   - valor máximo (numbers)
 *   pattern    {RegExp}   - formato esperado (aplicado como string)
 *   enum       {Array}    - lista de valores permitidos
 *
 * @param {object} data   - objeto a validar
 * @param {object} schema - mapa de campo → regras
 * @returns {string[]}    - lista de erros encontrados
 */
function validateSchema(data = {}, schema) {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
        let value = data[field];
        const isEmpty = value === undefined || value === null || value === '';

        if (rules.required && isEmpty) {
            errors.push(`'${field}' is required`);
            continue;
        }

        if (isEmpty) continue; // campo opcional não enviado — pula demais checks

        // Coerção: string numérica → number quando o schema espera number
        if (rules.type === 'number' && typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
            value = Number(value);
            data[field] = value; // atualiza o objeto para que o controller receba o valor convertido
        }

        // Coerção: "true"/"false" → boolean quando o schema espera boolean
        if (rules.type === 'boolean' && typeof value === 'string') {
            if (value === 'true')       { value = true;  data[field] = true;  }
            else if (value === 'false') { value = false; data[field] = false; }
        }

        if (rules.type === 'string' && typeof value !== 'string') {
            errors.push(`'${field}' must be a string`);
            continue;
        }
        if (rules.type === 'number' && (typeof value !== 'number' || isNaN(value))) {
            errors.push(`'${field}' must be a number`);
            continue;
        }
        if (rules.type === 'boolean' && typeof value !== 'boolean') {
            errors.push(`'${field}' must be a boolean`);
            continue;
        }
        if (rules.minLength != null && String(value).length < rules.minLength) {
            errors.push(`'${field}' must be at least ${rules.minLength} characters`);
        }
        if (rules.maxLength != null && String(value).length > rules.maxLength) {
            errors.push(`'${field}' must be at most ${rules.maxLength} characters`);
        }
        if (rules.min != null && value < rules.min) {
            errors.push(`'${field}' must be at least ${rules.min}`);
        }
        if (rules.max != null && value > rules.max) {
            errors.push(`'${field}' must be at most ${rules.max}`);
        }
        if (rules.pattern && !rules.pattern.test(String(value))) {
            errors.push(`'${field}' has an invalid format`);
        }
        if (rules.enum && !rules.enum.includes(value)) {
            errors.push(`'${field}' must be one of: ${rules.enum.join(', ')}`);
        }
    }

    return errors;
}

/**
 * Middleware factory que valida req[source] contra um schema.
 *
 * @param {object} schema         - schema de validação
 * @param {'body'|'query'|'params'} [source='body'] - fonte dos dados
 *
 * @example
 * router.post('/login', validate(loginSchema), asyncHandler(controller.login));
 */
function validate(schema, source = 'body') {
    return (req, res, next) => {
        const data = req[source];
        const errors = validateSchema(data, schema);
        if (errors.length) {
            return next(new BadRequestError(errors.join(' | ')));
        }
        next();
    };
}

module.exports = { validate, validateSchema };
