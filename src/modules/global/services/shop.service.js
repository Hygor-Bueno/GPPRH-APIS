'use strict';

const { poolGlobal }  = require('../../../config/mysql');
const { oracleQuery } = require('../../../config/oracle');
const { poolPromise } = require('../../../config/sqlserver');
const { AppError }    = require('../../../errors/app.error');

const SQL_MYSQL_SHOPS = `
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

const SQL_PROTHEUS = `
    SELECT
        RTRIM(M0_CODFIL) AS code,
        RTRIM(M0_FILIAL)  AS description,
        RTRIM(M0_CGC)     AS cnpj
    FROM TMPPRD12.dbo.SYS_COMPANY
    WHERE D_E_L_E_T_ = ' '
`;

const SQL_CONSINCO = `
    SELECT
        TO_CHAR(NROEMPRESA) AS CODE,
        FANTASIA            AS DESCRIPTION,
        NROCNPJ             AS CNPJ
    FROM consincodw.dim_empresa
`;

const normCnpj = (v) => String(v || '').replace(/\D/g, '');

class ShopService {

    async getShops(companyId = null) {
        const sql = companyId
            ? `SELECT s.id, s.number, s.description, s.cnpj
               FROM global._shop s
               INNER JOIN global._com_sho_dep_sub csds ON csds.shop_id = s.id
               WHERE csds.company_id = ?
               GROUP BY s.id ORDER BY s.number ASC`
            : `SELECT id, s.number, s.description, s.cnpj FROM global._shop s ORDER BY number ASC`;

        const [rows] = await poolGlobal.query(sql, companyId ? [companyId] : []);
        return rows;
    }

    async getAudit(source) {
        if (!['protheus', 'consinco'].includes(source)) {
            throw new AppError('Parâmetro source inválido. Use: protheus | consinco', 400);
        }

        // 1. MySQL — lojas + todos os códigos
        const [mysqlRows] = await poolGlobal.query(SQL_MYSQL_SHOPS);

        // Agrupa por CNPJ normalizado
        const mysqlByCnpj = new Map();
        for (const row of mysqlRows) {
            const key = normCnpj(row.cnpj);
            if (!mysqlByCnpj.has(key)) {
                mysqlByCnpj.set(key, {
                    shop_id:     row.shop_id,
                    number:      row.number,
                    description: row.description,
                    cnpj:        key,
                    codes:       {},
                });
            }
            if (row.system_name && row.code) {
                mysqlByCnpj.get(key).codes[row.system_name] = row.code;
            }
        }

        // 2. Fonte externa
        let externalRows;
        if (source === 'protheus') {
            const pool = await poolPromise;
            const result = await pool.request().query(SQL_PROTHEUS);
            externalRows = result.recordset.map(r => ({
                code:        r.code?.trim(),
                description: r.description?.trim(),
                cnpj:        normCnpj(r.cnpj),
            }));
        } else {
            const rows = await oracleQuery(SQL_CONSINCO);
            externalRows = rows.map(r => ({
                code:        String(r.CODE),
                description: r.DESCRIPTION,
                cnpj:        normCnpj(r.CNPJ),
            }));
        }

        // 3. Merge — deduplica por CNPJ (mantém primeira ocorrência)
        const seen = new Set();
        const result = [];

        for (const ext of externalRows) {
            if (!ext.cnpj || seen.has(ext.cnpj)) continue;
            seen.add(ext.cnpj);

            const mysql = mysqlByCnpj.get(ext.cnpj);

            result.push({
                cnpj:        ext.cnpj,
                description: ext.description,
                in_mysql:    !!mysql,
                shop_id:     mysql?.shop_id  ?? null,
                systems: {
                    c5:       mysql?.codes?.c5       ?? null,
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
}

module.exports = { ShopService };
