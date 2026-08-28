function sqlGetPayees(filters) {
    const params = {};
    const where  = [];

    if (filters.id       !== undefined) { where.push('id = @id');                     params.id       = filters.id; }
    if (filters.type     !== undefined) { where.push('type = @type');                 params.type     = filters.type; }
    if (filters.name     !== undefined) { where.push('name LIKE @name');              params.name     = `%${filters.name}%`; }
    if (filters.document !== undefined) { where.push('document = @document');         params.document = filters.document; }
    if (filters.is_active !== undefined){ where.push('is_active = @is_active');       params.is_active = filters.is_active; }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
        SELECT
            id,
            type,
            name,
            document,
            email,
            phone,
            is_active,
            created_at,
            created_by,
            created_by_branch_code,
            updated_at,
            updated_by,
            updated_by_branch_code
        FROM GIPP.dbo.gipp_payee
        ${whereClause}
        ORDER BY name;
    `;

    return { sql, params };
}

function sqlInsertPayee() {
    return `
        INSERT INTO GIPP.dbo.gipp_payee (
            type,
            name,
            document,
            email,
            phone,
            is_active,
            created_by,
            created_by_branch_code
        )
        VALUES (
            @type,
            @name,
            @document,
            @email,
            @phone,
            @is_active,
            @created_by,
            @created_by_branch_code
        );

        SELECT * FROM GIPP.dbo.gipp_payee WHERE id = SCOPE_IDENTITY();
    `;
}

function sqlUpdatePayee() {
    return `
        UPDATE GIPP.dbo.gipp_payee
        SET
            type                   = @type,
            name                   = @name,
            document               = @document,
            email                  = @email,
            phone                  = @phone,
            is_active              = @is_active,
            updated_at             = GETDATE(),
            updated_by             = @updated_by,
            updated_by_branch_code = @updated_by_branch_code
        WHERE id = @id;

        SELECT * FROM GIPP.dbo.gipp_payee WHERE id = @id;
    `;
}

const PATCH_PAYEE_FIELDS = {
    type:     'VarChar',
    name:     'VarChar',
    document: 'VarChar',
    email:    'VarChar',
    phone:    'VarChar',
    is_active:'Bit'
};

function sqlPatchPayee(fields) {
    const setClauses = [
        ...fields.map(f => `${f} = @${f}`),
        'updated_at             = GETDATE()',
        'updated_by             = @updated_by',
        'updated_by_branch_code = @updated_by_branch_code'
    ];

    return `
        UPDATE GIPP.dbo.gipp_payee
        SET ${setClauses.join(',\n            ')}
        WHERE id = @id;

        SELECT * FROM GIPP.dbo.gipp_payee WHERE id = @id;
    `;
}

function sqlDeletePayee() {
    return `
        DELETE FROM GIPP.dbo.gipp_payee WHERE id = @id;
    `;
}

module.exports = {
    sqlGetPayees,
    sqlInsertPayee,
    sqlUpdatePayee,
    sqlPatchPayee,
    sqlDeletePayee,
    PATCH_PAYEE_FIELDS
};
