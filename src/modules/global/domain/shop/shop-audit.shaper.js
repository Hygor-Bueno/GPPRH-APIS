/**
 * @fileoverview Lógica pura de auditoria de lojas — cruza o cadastro do MySQL
 * com uma fonte externa (Protheus ou Consinco) por CNPJ normalizado.
 *
 * @module modules/global/domain/shop/shop-audit.shaper
 */

/** Remove tudo que não for dígito de um CNPJ. */
function normalizeCnpj(value) {
    return String(value || '').replace(/\D/g, '');
}

/**
 * Agrupa as lojas do MySQL por CNPJ normalizado, consolidando os códigos de
 * cada sistema (`system_name` → `code`) numa única loja.
 * @param {Array<{shop_id:number, number:string, description:string, cnpj:string, system_name:?string, code:?string}>} mysqlRows
 * @returns {Map<string, {shop_id:number, number:string, description:string, cnpj:string, codes:object}>}
 */
function groupMysqlByCnpj(mysqlRows) {
    const map = new Map();

    for (const row of mysqlRows) {
        const key = normalizeCnpj(row.cnpj);
        if (!map.has(key)) {
            map.set(key, {
                shop_id: row.shop_id,
                number: row.number,
                description: row.description,
                cnpj: key,
                codes: {},
            });
        }
        if (row.system_name && row.code) {
            map.get(key).codes[row.system_name] = row.code;
        }
    }

    return map;
}

/**
 * Cruza as lojas da fonte externa com o cadastro do MySQL, deduplicando por
 * CNPJ (mantém a primeira ocorrência) e ordenando as já cadastradas primeiro.
 * @param {Array<{code:string, description:string, cnpj:string}>} externalRows
 * @param {Map<string, object>} mysqlByCnpj
 * @param {'protheus'|'consinco'} source
 */
function buildAuditResults(externalRows, mysqlByCnpj, source) {
    const seen = new Set();
    const result = [];

    for (const ext of externalRows) {
        if (!ext.cnpj || seen.has(ext.cnpj)) continue;
        seen.add(ext.cnpj);

        const mysql = mysqlByCnpj.get(ext.cnpj);

        result.push({
            cnpj: ext.cnpj,
            description: ext.description,
            in_mysql: !!mysql,
            shop_id: mysql?.shop_id ?? null,
            systems: {
                c5: mysql?.codes?.c5 ?? null,
                protheus: mysql?.codes?.protheus ?? null,
                consinco: mysql?.codes?.consinco ?? null,
                [source]: ext.code,
            },
        });
    }

    // Cadastradas no MySQL primeiro, pendentes depois
    result.sort((a, b) => b.in_mysql - a.in_mysql);

    return result;
}

module.exports = { normalizeCnpj, groupMysqlByCnpj, buildAuditResults };
