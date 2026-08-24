/** Empresas do Consinco (dim_empresa), pra auditoria de lojas. */
function sqlGetConsincoShops() {
    return `
    SELECT
        TO_CHAR(NROEMPRESA) AS CODE,
        FANTASIA            AS DESCRIPTION,
        NROCNPJ             AS CNPJ
    FROM consincodw.dim_empresa
`;
}

module.exports = { sqlGetConsincoShops };
