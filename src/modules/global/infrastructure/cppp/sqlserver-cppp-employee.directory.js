/**
 * @fileoverview Contrato do funcionário no Protheus, por CPF, em tempo real.
 *
 * Sem cópia em tabela da suite (regra da casa: ler Protheus/Consinco ao vivo,
 * nunca duplicar cadastro).
 *
 * @module modules/global/infrastructure/cppp/sqlserver-cppp-employee.directory
 */

const { poolPromise, sql } = require('../../../../config/sqlserver');
const { CpppEmployeeDirectoryPort } = require('../../application/cppp/ports/cppp-external.ports');
const { sqlFindEmployeesByCpf } = require('../../repositories/sqlserver/cppp-employee.queries');
const { normalizeProtheusDate, pickContract } = require('../../domain/cppp/employee.rules');

/** Bem abaixo do teto de 2.100 parâmetros do SQL Server. */
const CHUNK = 500;

class SqlServerCpppEmployeeDirectory extends CpppEmployeeDirectoryPort {
    async findByIdentifiers(identifiers) {
        const unique = [...new Set(identifiers)];
        const byCpf = new Map();
        if (!unique.length) return byCpf;

        const pool = await poolPromise;
        for (let i = 0; i < unique.length; i += CHUNK) {
            const chunk = unique.slice(i, i + CHUNK);
            const request = pool.request();
            chunk.forEach((id, index) => request.input(`id${index}`, sql.VarChar(11), id));
            const { recordset } = await request.query(sqlFindEmployeesByCpf(chunk.length));

            for (const row of recordset) {
                if (!byCpf.has(row.cpf)) byCpf.set(row.cpf, []);
                byCpf.get(row.cpf).push({
                    registration: row.registration,
                    name: row.name || row.full_name,
                    full_name: row.full_name,
                    branch_code: row.branch_code,
                    branch_name: row.branch_name,
                    company_name: row.company_name,
                    cost_center: row.cost_center,
                    admittedAt: normalizeProtheusDate(row.admitted),
                    dismissedAt: normalizeProtheusDate(row.dismissed),
                    day_hours: row.day_hours === null || row.day_hours === undefined ? null : Number(row.day_hours),
                });
            }
        }

        const result = new Map();
        for (const [cpf, rows] of byCpf) {
            const contract = pickContract(rows);
            const { admittedAt, dismissedAt, ...rest } = contract;
            result.set(cpf, {
                ...rest,
                admitted_at: admittedAt,
                dismissed_at: dismissedAt,
                contract_status: dismissedAt ? 'desligado' : 'ativo',
                contracts_found: rows.length,
            });
        }
        return result;
    }
}

module.exports = { SqlServerCpppEmployeeDirectory };
