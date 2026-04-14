function sqlActiveBeneficiaries() {
    return `SELECT
                rh.RA_NOME as name,
                comp.M0_FULNAME as comapany_name,
                comp.M0_FILIAL as branch_name,
                ec.*,
                c.description as compensation_description
            FROM 
                GIPP.dbo.gipp_rh_employee_compensation ec
                
                INNER JOIN GIPP.dbo.gipp_rh_compensation c
                ON c.id = ec.compensation_id

                INNER JOIN TMPPRD12.dbo.SRA020 rh
                ON rh.RA_MAT = ec.employee_id
                AND rh.RA_FILIAL = ec.branch_code

                INNER JOIN TMPPRD12.dbo.SYS_COMPANY comp
                ON comp.M0_CODFIL = ec.branch_code

            WHERE end_date is null;`;
}
function sqlEmployeesCompensations() {
    return "select * from  GIPP.dbo.gipp_rh_compensation order by id desc;";
}
function sqlUpdateCompensation({ id, name, description, active, user_code, branch_code }) {
    return `EXEC dbo.sp_update_gipp_rh_compensation
    @id = ${id},
    @name = '${name}',
    @description = '${description}',
    @active = ${active},
    @user_code = '${user_code}',
    @user_branch = '${branch_code}';`;
}
function sqlInsertCompensation() {
    return `
        INSERT INTO GIPP.dbo.gipp_rh_compensation (
            name,
            description,
            active,
            
            created_by,
            created_by_branch
        )
        OUTPUT INSERTED.*
        VALUES (
            @name,
            @description,
            @active,
            
            @created_by,
            @created_by_branch
        )
    `;
}

function sqlGetEmployeesPaginated() {
    return `
        EXEC dbo.pcr_get_employees_paginated
            @PageNumber = @PageNumber,
            @PageSize = @PageSize,
            @EmployeeName = @EmployeeName,
            @CostCenterCode = @CostCenterCode,
            @BranchCode = @BranchCode,
            @CompanyCNPJ = @CompanyCNPJ,
            @Status = @Status
    `;
}

function sqlGetBeneficiariesByEmployee(employeeCode, branchCode, referenceInit, referenceEnd) {
    let where = [];

    if (employeeCode) where.push(`rec.employee_code = ${employeeCode}`);
    if (branchCode) where.push(`rec.branch_code = ${branchCode}`);
    if (referenceInit) where.push(`rec.reference between ${referenceInit} AND ${referenceEnd ? referenceEnd : referenceInit}`);

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    return `
        WITH base AS (
            SELECT
                rec.id,
                rec.receipt_group_id,
                rec.employee_code,
                LTRIM(RTRIM(rec.employee_name)) AS employee_name,
                rec.reference,
                rec.description,
                rec.amount,
                rec.movement_type,
                rec.created_at,

                LTRIM(RTRIM(comp.M0_NOME)) AS company,
                comp.M0_CGC AS cnpj,

                LTRIM(RTRIM(comp.M0_ENDENT)) + ' - ' +
                LTRIM(RTRIM(comp.M0_BAIRENT)) + ' - ' +
                LTRIM(RTRIM(comp.M0_CIDENT)) + '/' +
                LTRIM(RTRIM(comp.M0_ESTENT)) + ' - CEP: ' +
                LTRIM(RTRIM(comp.M0_CEPENT)) AS endereco,

                cc.CTT_DESC01 AS funcao

            FROM GIPP.dbo.gipp_payment_receipt rec

            INNER JOIN TMPPRD12.dbo.SYS_COMPANY comp
                ON comp.M0_CODFIL = rec.branch_code
                AND comp.D_E_L_E_T_ != '*'

            INNER JOIN TMPPRD12.dbo.SRA020 emp
                ON emp.RA_MAT = rec.employee_code
                AND emp.D_E_L_E_T_ != '*'
                AND emp.RA_DEMISSA = ''

            INNER JOIN TMPPRD12.dbo.CTT020 cc
                ON cc.CTT_CUSTO = emp.RA_CC
                AND cc.D_E_L_E_T_ != '*'

            ${whereClause}
        )

        SELECT DISTINCT
            b.company AS empresa,
            b.endereco,
            b.cnpj,
            b.reference,
            RIGHT(b.reference, 2) + '/' + LEFT(b.reference, 4) AS mesReferencia,

            b.employee_code AS matricula,
            b.employee_name AS nome,
            b.funcao,

            JSON_QUERY((
                SELECT
                    b2.description AS descricao,
                    b.reference AS referencia,
                    CASE WHEN b2.movement_type = 'E' THEN b2.amount ELSE 0 END AS proventos,
                    CASE WHEN b2.movement_type = 'D' THEN b2.amount ELSE 0 END AS descontos
                FROM base b2
                WHERE b2.receipt_group_id = b.receipt_group_id
                ORDER BY 
                    CASE WHEN b2.movement_type = 'E' THEN 1 ELSE 2 END,
                    b2.id
                FOR JSON PATH
            )) AS itens,

            CONVERT(VARCHAR(10), b.created_at, 103) AS dataStr

        FROM base b
        ORDER BY b.reference DESC
        FOR JSON PATH;
    `;
}

function sqlGetReceiptsBatch(recipients) {
  // recipients: Array<{ employee_code, branch_code, references: string[] }>

  // monta um OR para cada combinação employee+branch+references
  const conditions = recipients.map(({ employee_code, branch_code, references }) => {
    const refs = references.map(r => `'${r}'`).join(', ');
    return `(
      rec.employee_code = '${employee_code}'
      AND rec.branch_code = '${branch_code}'
      AND rec.reference IN (${refs})
    )`;
  });

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' OR ')}`
    : '';

  return `
    WITH base AS (
      SELECT
        rec.id,
        rec.receipt_group_id,
        rec.employee_code,
        LTRIM(RTRIM(rec.employee_name))   AS employee_name,
        rec.branch_code,
        rec.reference,
        rec.description,
        rec.amount,
        rec.movement_type,
        rec.created_at,

        LTRIM(RTRIM(comp.M0_NOME))        AS company,
        comp.M0_CGC                        AS cnpj,

        LTRIM(RTRIM(comp.M0_ENDENT)) + ' - ' +
        LTRIM(RTRIM(comp.M0_BAIRENT)) + ' - ' +
        LTRIM(RTRIM(comp.M0_CIDENT)) + '/' +
        LTRIM(RTRIM(comp.M0_ESTENT)) + ' - CEP: ' +
        LTRIM(RTRIM(comp.M0_CEPENT))      AS endereco,

        cc.CTT_DESC01                      AS funcao

      FROM GIPP.dbo.gipp_payment_receipt rec

      INNER JOIN TMPPRD12.dbo.SYS_COMPANY comp
        ON comp.M0_CODFIL = rec.branch_code
        AND comp.D_E_L_E_T_ != '*'

      INNER JOIN TMPPRD12.dbo.SRA020 emp
        ON emp.RA_MAT  = rec.employee_code
        AND emp.D_E_L_E_T_ != '*'
        AND emp.RA_DEMISSA = ''

      INNER JOIN TMPPRD12.dbo.CTT020 cc
        ON cc.CTT_CUSTO = emp.RA_CC
        AND cc.D_E_L_E_T_ != '*'

      ${whereClause}
    )

    SELECT DISTINCT
      b.company       AS empresa,
      b.endereco,
      b.cnpj,
      b.branch_code,
      b.reference,
      RIGHT(b.reference, 2) + '/' + LEFT(b.reference, 4) AS mesReferencia,

      b.employee_code AS matricula,
      b.employee_name AS nome,
      b.funcao,

      JSON_QUERY((
        SELECT
          b2.description                                          AS descricao,
          b.reference                                             AS referencia,
          CASE WHEN b2.movement_type = 'E' THEN b2.amount ELSE 0 END AS proventos,
          CASE WHEN b2.movement_type = 'D' THEN b2.amount ELSE 0 END AS descontos
        FROM base b2
        WHERE b2.receipt_group_id = b.receipt_group_id
        ORDER BY
          CASE WHEN b2.movement_type = 'E' THEN 1 ELSE 2 END,
          b2.id
        FOR JSON PATH
      )) AS itens,

      CONVERT(VARCHAR(10), b.created_at, 103) AS dataStr

    FROM base b
    ORDER BY b.employee_code, b.branch_code, b.reference DESC
    FOR JSON PATH;
  `;
}

function sqlGetReceipt(employeeCode, branchCode, referenceInit, referenceTwo) {
    let where = [];

    if (employeeCode) where.push(`c.employee_code = ${employeeCode}`);
    if (branchCode) where.push(`c.branch_code = ${branchCode}`);
    if (referenceInit) where.push(`c.reference between ${referenceInit} AND ${referenceTwo ? referenceTwo : referenceInit}`);

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    console.log(where);
    return `
            SELECT
            c.employee_code,
            emp.RA_NOME AS name,
            c.branch_code,
            c.branch_name,
            c.company_code,
            comp.M0_NOMECOM AS company_name,
            c.reference,
            SUM(
                CASE
                    WHEN c.movement_type = 'E' THEN  c.amount
                    WHEN c.movement_type = 'D' THEN -c.amount
                    ELSE 0
                END
            ) AS amount
        FROM GIPP.dbo.gipp_payment_receipt c

            LEFT JOIN TMPPRD12.dbo.SYS_COMPANY comp
                ON comp.M0_CODFIL = c.branch_code
                AND comp.D_E_L_E_T_ <> '*'

            LEFT JOIN TMPPRD12.dbo.SRA020 emp
                ON emp.RA_MAT = c.employee_code
                AND emp.D_E_L_E_T_ <> '*'
                AND emp.RA_DEMISSA = ''
        ${whereClause}
        GROUP BY
            c.employee_code,
            emp.RA_NOME,
            c.reference,
            c.branch_code,
            comp.M0_NOMECOM,
            c.company_code,
            c.branch_name
        ORDER BY c.reference DESC;
    `;
}
module.exports = {
    sqlEmployeesCompensations,
    sqlActiveBeneficiaries,
    sqlInsertCompensation,
    sqlUpdateCompensation,
    sqlGetEmployeesPaginated,
    sqlGetBeneficiariesByEmployee,
    sqlGetReceipt,
    sqlGetReceiptsBatch
};