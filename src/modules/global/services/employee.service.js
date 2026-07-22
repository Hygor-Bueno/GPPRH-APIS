const { poolGlobal }  = require('../../../config/mysql');
const { poolPromise } = require('../../../config/protheus');
const { AppError }    = require('../../../errors/app.error');
const { sqlGetEmployeesFiltered, sqlGetUsersFiltered, PAGE_SIZE } = require('../repositories/mysql/employee.repository');
const { sqlGetUserOrganizationBatch } = require('../../protheus/repositories/cost-center.repository');

class Employee {
    constructor(id = 0) {
        this.id = id;
    }
    async getEmployeePhoto() {
        try {

            const [rows] = await poolGlobal.execute(
                "SELECT photo FROM _employee WHERE id = ?",
                [this.id]
            );

            if (!rows.length || !rows[0].photo) {
                throw new Error("Photo not found");
            }

            return rows[0].photo;
        } catch (error) {
            throw new AppError(
                error.sqlMessage,
                500,              // status HTTP
                error.code,       // código MySQL
                error
            );
        }
    }
    async updateEmployeePhoto(imageBuffer) {
        try {
            const [result] = await poolGlobal.execute(
                "UPDATE global._employee SET photo = ? WHERE id = ?",
                [imageBuffer, this.id]
            );

            if (result.affectedRows === 0) {
                throw new AppError("Employee not found", 404);
            }

        } catch (error) {
            throw new AppError(
                error.sqlMessage || error.message,
                500,
                error.code,
                error
            );
        }
    }
}

/**
 * Retorna colaboradores paginados com filtros opcionais.
 *
 * Chama a stored procedure `prcGetEmployeeDetails`.
 * O campo `employee_photo` é convertido para Base64 quando presente.
 *
 * @param {Object} filters
 * @param {number}      [filters.pPage=1]
 * @param {number}      [filters.pPageSize=10]
 * @param {string|null} [filters.pEmployeeName]
 * @param {number|null} [filters.pCompanyId]
 * @param {number|null} [filters.pShopId]
 * @param {number|null} [filters.pDepartmentId]
 * @param {number|null} [filters.pSubDepartmentId]
 * @param {number|null} [filters.pApplicationAccess]
 * @returns {Promise<{ data: Object[], totalRecords: number, limitPage: number, page: number }>}
 */
async function getEmployeesFiltered(filters = {}) {
    const page             = parseInt(filters.pPage, 10)             || 1;
    const pageSize         = parseInt(filters.pPageSize, 10)         || PAGE_SIZE;
    const employeeName     = filters.pEmployeeName     ?? null;
    const companyId        = filters.pCompanyId        ? parseInt(filters.pCompanyId, 10)        : null;
    const shopId           = filters.pShopId           ? parseInt(filters.pShopId, 10)           : null;
    const departmentId     = filters.pDepartmentId     ? parseInt(filters.pDepartmentId, 10)     : null;
    const subDepartmentId  = filters.pSubDepartmentId  ? parseInt(filters.pSubDepartmentId, 10)  : null;
    const applicationAccess = filters.pApplicationAccess ? parseInt(filters.pApplicationAccess, 10) : null;

    try {
        const [results] = await poolGlobal.execute(sqlGetEmployeesFiltered(), [
            page,
            pageSize,
            employeeName,
            companyId,
            shopId,
            departmentId,
            subDepartmentId,
            applicationAccess,
        ]);

        // stored procedure retorna array de result sets — o primeiro é os dados
        const rows = Array.isArray(results[0]) ? results[0] : results;

        if (!rows || rows.length === 0) {
            return { data: [], totalRecords: 0, limitPage: 1, page };
        }

        const totalRecords = rows[0].total_records ?? 0;
        const limitPage    = rows[0].total_pages   ?? 1;

        // Converte employee_photo para Base64 (quando presente)
        const data = rows.map(row => {
            if (row.employee_photo) {
                row.employee_photo = Buffer.isBuffer(row.employee_photo)
                    ? row.employee_photo.toString('base64')
                    : row.employee_photo;
            }
            return row;
        });

        return { data, totalRecords, limitPage, page };

    } catch (error) {
        throw new AppError(
            error.sqlMessage || 'Erro ao buscar colaboradores.',
            500,
            error.code,
            error
        );
    }
}

/**
 * Lista usuários paginados com enriquecimento do Protheus (empresa, filial, centro de custo).
 *
 * Fluxo:
 *   1. MySQL  → sp_global_get_users  (id, name, registration, status, file_id, branch_code)
 *   2. Protheus → SRA020 + CTT020 + SYS_COMPANY por matrícula
 *   3. Merge por registration no Node.js
 *
 * @param {Object} filters
 * @param {number}      [filters.pPage=1]
 * @param {number}      [filters.pPageSize=10]
 * @param {string|null} [filters.pName]
 * @param {number|null} [filters.pApplicationId]
 * @param {number|null} [filters.pStatus]        1 ativo / 0 inativo / null = todos
 * @returns {Promise<{ data: Object[], totalRecords: number, limitPage: number, page: number }>}
 */
async function getUsersFiltered(filters = {}) {
    const page          = parseInt(filters.pPage, 10)          || 1;
    const pageSize      = parseInt(filters.pPageSize, 10)      || PAGE_SIZE;
    const name          = filters.pName          ?? null;
    const applicationId = filters.pApplicationId ? parseInt(filters.pApplicationId, 10) : null;
    const status        = filters.pStatus        != null       ? parseInt(filters.pStatus, 10) : null;

    // ── 1. MySQL ──────────────────────────────────────────────────────────────
    let rows;
    try {
        const [results] = await poolGlobal.execute(sqlGetUsersFiltered(), [
            page, pageSize, name, applicationId, status,
        ]);
        rows = Array.isArray(results[0]) ? results[0] : results;
    } catch (err) {
        throw new AppError(err.sqlMessage || 'Erro ao buscar usuários.', 500, err.code, err);
    }

    if (!rows || rows.length === 0) {
        return { data: [], totalRecords: 0, limitPage: 1, page };
    }

    const totalRecords = rows[0].total_records ?? 0;
    const limitPage    = rows[0].total_pages   ?? 1;

    // Filtra linhas que possuem registration para enriquecer no Protheus
    const registrations = rows
        .map(r => r.registration)
        .filter(Boolean);

    // ── 2. Protheus ───────────────────────────────────────────────────────────
    const orgMap = new Map(); // registration → dados Protheus

    if (registrations.length > 0) {
        try {
            const pool    = await poolPromise;
            const request = pool.request();

            registrations.forEach((reg, i) => request.input(`r${i}`, reg));

            const { recordset } = await request.query(
                sqlGetUserOrganizationBatch(registrations.length)
            );

            for (const row of recordset) {
                orgMap.set(row.registration?.trim(), row);
            }
        } catch {
            // Protheus indisponível: retorna dados do MySQL sem enriquecimento
        }
    }

    // ── 3. Merge ──────────────────────────────────────────────────────────────
    const data = rows
        .filter(({ registration }) => {
            const org = orgMap.get(registration?.trim());
            // Se encontrou no Protheus e tem data de demissão, exclui
            return !(org && org.ra_demissa);
        })
        .map(({ total_records, total_pages, ...user }) => {
            const org = orgMap.get(user.registration?.trim()) ?? {};
            return {
                id:                       user.id,
                name:                     user.name,
                registration:             user.registration,
                status:                   user.status,
                file_id:                  user.file_id   ?? null,
                branch_code:              user.branch_code ?? null,
                company_code:             org.company_code             ?? null,
                company_name:             org.company_name             ?? null,
                branch_name:              org.branch_name              ?? null,
                cnpj:                     org.cnpj                     ?? null,
                cost_center_code:         org.cost_center_code         ?? null,
                cost_center_description:  org.cost_center_description  ?? null,
            };
        });

    return { data, totalRecords, limitPage, page };
}

module.exports = { Employee, getEmployeesFiltered, getUsersFiltered };