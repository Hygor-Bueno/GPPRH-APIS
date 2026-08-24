/**
 * @fileoverview Schemas de validação — Gestão de Acessos.
 *
 * Define as regras de validação para as rotas de gestão de usuários, papéis,
 * permissões e acessos a aplicações, usando o validador customizado do projeto.
 *
 * @module schemas/access.schema
 */

// ─── Usuários ──────────────────────────────────────────────────────────────────

/**
 * Schema para criação de usuário (POST /access/users).
 */
const postUserSchema = {
    user: {
        type:      'string',
        required:  true,
        minLength: 2,
        maxLength: 45
    },
    password: {
        type:      'string',
        required:  false,
        minLength: 4,
        maxLength: 100
    },
    name: {
        type:      'string',
        required:  false,
        maxLength: 100
    },
    registration: {
        type:      'string',
        required:  false,
        maxLength: 10
    },
    branch_code: {
        type:      'string',
        required:  false,
        maxLength: 4
    },
    ad_status: {
        type:     'string',
        required: false,
        enum:     ['pending', 'active', 'blocked', 'delete']
    },
    administrator: {
        type:     'number',
        required: false,
        min:      0,
        max:      1
    },
    table_protheus: {
        type:      'string',
        required:  false,
        maxLength: 45
    }
};

/**
 * Schema para atualização completa de usuário (PUT /access/users/:id).
 */
const putUserSchema = {
    name: {
        type:      'string',
        required:  true,
        maxLength: 100
    },
    registration: {
        type:      'string',
        required:  false,
        maxLength: 10
    },
    branch_code: {
        type:      'string',
        required:  false,
        maxLength: 4
    },
    ad_status: {
        type:     'string',
        required: true,
        enum:     ['pending', 'active', 'blocked', 'delete']
    },
    administrator: {
        type:     'number',
        required: true,
        min:      0,
        max:      1
    },
    table_protheus: {
        type:      'string',
        required:  false,
        maxLength: 45
    }
};

/**
 * Schema para atualização parcial de usuário (PATCH /access/users/:id).
 * Ao menos um campo deve ser enviado (validado no service).
 */
const patchUserSchema = {
    name: {
        type:      'string',
        required:  false,
        maxLength: 100
    },
    registration: {
        type:      'string',
        required:  false,
        maxLength: 10
    },
    branch_code: {
        type:      'string',
        required:  false,
        maxLength: 4
    },
    administrator: {
        type:     'number',
        required: false,
        min:      0,
        max:      1
    },
    table_protheus: {
        type:      'string',
        required:  false,
        maxLength: 45
    },
    ad_status: {
        type:     'string',
        required: false,
        enum:     ['pending', 'active', 'blocked', 'delete']
    },
    password: {
        type:      'string',
        required:  false,
        minLength: 4,
        maxLength: 100
    }
};

// ─── Papéis (Roles) ────────────────────────────────────────────────────────────

/**
 * Schema para criação de papel (POST /access/roles).
 */
const postRoleSchema = {
    name: {
        type:      'string',
        required:  true,
        minLength: 2,
        maxLength: 50
    },
    description: {
        type:      'string',
        required:  false,
        maxLength: 255
    }
};

/**
 * Schema para atualização de papel (PUT /access/roles/:id).
 */
const putRoleSchema = {
    name: {
        type:      'string',
        required:  true,
        minLength: 2,
        maxLength: 50
    },
    description: {
        type:      'string',
        required:  false,
        maxLength: 255
    }
};

// ─── Permissões ────────────────────────────────────────────────────────────────

/**
 * Schema para criação de permissão (POST /access/permissions).
 */
const postPermissionSchema = {
    code: {
        type:      'string',
        required:  true,
        minLength: 2,
        maxLength: 100
    },
    description: {
        type:      'string',
        required:  false,
        maxLength: 255
    }
};

/**
 * Schema para atualização de permissão (PUT /access/permissions/:id).
 */
const putPermissionSchema = {
    code: {
        type:      'string',
        required:  true,
        minLength: 2,
        maxLength: 100
    },
    description: {
        type:      'string',
        required:  false,
        maxLength: 255
    }
};

// ─── Vínculos ──────────────────────────────────────────────────────────────────

/**
 * Schema para associar papéis a um usuário (POST /access/users/:id/roles).
 * `role_ids` deve ser um array não vazio de números inteiros.
 */
const assignRolesSchema = {
    role_ids: {
        type:     'array',
        required: true
    }
};

/**
 * Schema para associar permissões a um papel (POST /access/roles/:id/permissions).
 * `permission_ids` deve ser um array não vazio de números inteiros.
 */
const assignPermissionsSchema = {
    permission_ids: {
        type:     'array',
        required: true
    }
};

/**
 * Schema para substituição completa das permissões de um papel
 * (PUT /access/roles/:id/permissions).
 */
const setPermissionsSchema = {
    permission_ids: {
        type:     'array',
        required: true
    }
};

// ─── Aplicações ────────────────────────────────────────────────────────────────

/**
 * Schema para concessão de acesso a uma aplicação
 * (POST /access/users/:id/applications).
 */
const grantApplicationSchema = {
    application_id: {
        type:     'number',
        required: true,
        min:      1
    }
};

module.exports = {
    // Usuários
    postUserSchema,
    putUserSchema,
    patchUserSchema,
    // Papéis
    postRoleSchema,
    putRoleSchema,
    // Permissões
    postPermissionSchema,
    putPermissionSchema,
    // Vínculos
    assignRolesSchema,
    assignPermissionsSchema,
    setPermissionsSchema,
    // Aplicações
    grantApplicationSchema
};
