const postPayeeSchema = {
    type:     { type: 'string', required: true, enum: ['FREELANCER', 'SERVICE_PROVIDER'] },
    name:     { type: 'string', required: true, minLength: 1, maxLength: 200 },
    document: { type: 'string', maxLength: 20 },
    email:    { type: 'string', maxLength: 100 },
    phone:    { type: 'string', maxLength: 20 },
    is_active:{ type: 'boolean', required: true }
};

const putPayeeSchema = {
    id:       { type: 'number', required: true },
    type:     { type: 'string', required: true, enum: ['FREELANCER', 'SERVICE_PROVIDER'] },
    name:     { type: 'string', required: true, minLength: 1, maxLength: 200 },
    document: { type: 'string', maxLength: 20 },
    email:    { type: 'string', maxLength: 100 },
    phone:    { type: 'string', maxLength: 20 },
    is_active:{ type: 'boolean', required: true }
};

const patchPayeeSchema = {
    id:       { type: 'number',  required: true },
    type:     { type: 'string',  enum: ['FREELANCER', 'SERVICE_PROVIDER'] },
    name:     { type: 'string',  minLength: 1, maxLength: 200 },
    document: { type: 'string',  maxLength: 20 },
    email:    { type: 'string',  maxLength: 100 },
    phone:    { type: 'string',  maxLength: 20 },
    is_active:{ type: 'boolean' }
};

module.exports = { postPayeeSchema, putPayeeSchema, patchPayeeSchema };
