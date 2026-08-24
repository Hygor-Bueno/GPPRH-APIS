/**
 * @fileoverview Casos de uso — Employee.
 * @module modules/global/application/employee/employee.use-cases
 */

const { AppError } = require('../../../../errors/app.error');
const { buildOrgMap, mergeUsersWithOrganization } = require('../../domain/employee/user-organization.shaper');
const { PAGE_SIZE } = require('../../repositories/mysql/employee.queries');

class EmployeeUseCases {
    /**
     * @param {{
     *   repository: import('./ports/employee-repository.port').EmployeeRepositoryPort,
     *   protheusRepository: import('./ports/protheus-organization-repository.port').ProtheusOrganizationRepositoryPort,
     * }} deps
     */
    constructor({ repository, protheusRepository }) {
        this.repository = repository;
        this.protheusRepository = protheusRepository;
    }

    /** @throws {AppError} 404 se não houver foto */
    async getEmployeePhoto(employeeId) {
        const record = await this.repository.findPhotoRecord(employeeId);
        if (!record) throw new AppError('Foto não encontrada.', 404);
        return record;
    }

    /**
     * @param {number} employeeId @param {Express.Multer.File} file @param {number} actingUserId
     * @throws {AppError} 404 se o colaborador não existir
     */
    async updateEmployeePhoto(employeeId, file, actingUserId) {
        const { affectedRows } = await this.repository.attachPhoto(employeeId, file, actingUserId);
        if (affectedRows === 0) throw new AppError('Colaborador não encontrado.', 404);
    }

    /**
     * Retorna colaboradores paginados com filtros opcionais.
     * Chama a stored procedure `prcGetEmployeeDetails`.
     */
    async getEmployeesFiltered(filters = {}) {
        const page = parseInt(filters.pPage, 10) || 1;
        const pageSize = parseInt(filters.pPageSize, 10) || PAGE_SIZE;

        const { rows, totalRecords, limitPage } = await this.repository.findEmployeesFiltered({
            page,
            pageSize,
            employeeName: filters.pEmployeeName ?? null,
            companyId: filters.pCompanyId ? parseInt(filters.pCompanyId, 10) : null,
            shopId: filters.pShopId ? parseInt(filters.pShopId, 10) : null,
            departmentId: filters.pDepartmentId ? parseInt(filters.pDepartmentId, 10) : null,
            subDepartmentId: filters.pSubDepartmentId ? parseInt(filters.pSubDepartmentId, 10) : null,
            applicationAccess: filters.pApplicationAccess ? parseInt(filters.pApplicationAccess, 10) : null,
        });

        return { data: rows, totalRecords, limitPage, page };
    }

    /**
     * Lista usuários paginados com enriquecimento do Protheus (empresa, filial, centro de custo).
     * Se o Protheus estiver indisponível, retorna os dados do MySQL sem enriquecimento.
     */
    async getUsersFiltered(filters = {}) {
        const page = parseInt(filters.pPage, 10) || 1;
        const pageSize = parseInt(filters.pPageSize, 10) || PAGE_SIZE;

        const { rows, totalRecords, limitPage } = await this.repository.findUsersFiltered({
            page,
            pageSize,
            name: filters.pName ?? null,
            applicationId: filters.pApplicationId ? parseInt(filters.pApplicationId, 10) : null,
            status: filters.pStatus != null ? parseInt(filters.pStatus, 10) : null,
        });

        if (!rows || rows.length === 0) {
            return { data: [], totalRecords: 0, limitPage: 1, page };
        }

        const orgLookups = rows
            .filter(r => r.registration)
            .map(r => ({ registration: r.registration, branch_code: r.branch_code }));

        let orgMap = new Map();
        if (orgLookups.length > 0) {
            try {
                const protheusRows = await this.protheusRepository.findOrganizationBatch(orgLookups);
                orgMap = buildOrgMap(protheusRows);
            } catch {
                // Protheus indisponível: retorna dados do MySQL sem enriquecimento
            }
        }

        const data = mergeUsersWithOrganization(rows, orgMap);
        return { data, totalRecords, limitPage, page };
    }
}

module.exports = { EmployeeUseCases };
