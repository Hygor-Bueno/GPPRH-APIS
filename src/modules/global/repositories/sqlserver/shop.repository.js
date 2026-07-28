/** Filiais do Protheus (SYS_COMPANY), pra auditoria de lojas. */
function sqlGetProtheusShops() {
    return `
    SELECT
        RTRIM(M0_CODFIL) AS code,
        RTRIM(M0_FILIAL)  AS description,
        RTRIM(M0_CGC)     AS cnpj
    FROM TMPPRD12.dbo.SYS_COMPANY
    WHERE D_E_L_E_T_ = ' '
`;
}

module.exports = { sqlGetProtheusShops };
