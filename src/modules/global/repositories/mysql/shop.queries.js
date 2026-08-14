/**
 * @fileoverview Queries SQL puras — Shop.
 * @module modules/global/repositories/mysql/shop.queries
 */

'use strict';

const SQL_GET_SHOPS = `SELECT id, s.number, s.description, s.cnpj FROM global._shop s ORDER BY number ASC`;

const SQL_GET_SHOPS_BY_COMPANY = `
    SELECT s.id, s.number, s.description, s.cnpj
    FROM global._shop s
    INNER JOIN global._com_sho_dep_sub csds ON csds.shop_id = s.id
    WHERE csds.company_id = ?
    GROUP BY s.id ORDER BY s.number ASC
`;

/**
 * Lojas que existem no Consinco — usada pelo seletor de loja do BPPP.
 *
 * O BPPP consulta preço/estoque no ERP Consinco, então só faz sentido oferecer
 * lojas com código lá. O `INNER JOIN` em `_shop_codes` é o filtro.
 *
 * `GROUP BY s.id` está aqui de propósito: se uma loja tiver mais de uma linha
 * em `_shop_codes` com `system_name = 'consinco'`, o join duplicaria a loja no
 * seletor. Mesma proteção que a `SQL_GET_SHOPS_BY_COMPANY` acima usa.
 */
const SQL_GET_SHOPS_CONSINCO = `
    SELECT s.id, s.number, s.description, s.cnpj
    FROM global._shop s
    INNER JOIN global._shop_codes sc ON sc.shop_id = s.id
    WHERE sc.system_name = 'consinco'
    GROUP BY s.id
    ORDER BY s.number ASC
`;

/** Lojas com todos os códigos de sistema vinculados (system_name/code), pra auditoria. */
const SQL_GET_SHOPS_WITH_CODES = `
    SELECT
        s.id          AS shop_id,
        s.number,
        s.description,
        s.cnpj,
        sc.system_name,
        sc.code
    FROM global._shop s
    LEFT JOIN global._shop_codes sc ON sc.shop_id = s.id
`;

module.exports = {
    SQL_GET_SHOPS,
    SQL_GET_SHOPS_BY_COMPANY,
    SQL_GET_SHOPS_CONSINCO,
    SQL_GET_SHOPS_WITH_CODES,
};
