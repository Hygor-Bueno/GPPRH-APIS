const { AppError } = require("../../../errors/app.error");
const { respond } = require("../../../utils/respond");
const { FileService } = require("../../../utils/file/file.service");
const { EmployeeUseCases } = require("../application/employee/employee.use-cases");
const { MysqlEmployeeRepository } = require("../infrastructure/employee/mysql-employee.repository");
const { SqlServerProtheusOrganizationRepository } = require("../infrastructure/employee/sqlserver-protheus-organization.repository");

const useCases = new EmployeeUseCases({
    repository: new MysqlEmployeeRepository(),
    protheusRepository: new SqlServerProtheusOrganizationRepository(),
});

async function getPhotoEmployee(req, res) {
    const { id } = req.params;
    if (!id || id == 0) {
        throw new AppError('Id is riquired', 400);
    }

    const record = await useCases.getEmployeePhoto(id);
    const absolutePath = FileService.absolutePath(record);
    return res.sendFile(absolutePath, err => {
        if (err) {
            console.error(`[employee:photo] Arquivo não encontrado em disco: ${absolutePath}`, err.message);
            res.status(404).json({ error: true, message: 'Foto não encontrada.' });
        }
    });
};
async function postPhotoEmployee(req, res) {
    const { id } = req.params;
    if (!id || id == 0) {
        throw new AppError('Id is required', 400);
    }

    if (!req.file) {
        throw new AppError('No image was sent', 400);
    }

    if (!req.file.mimetype.startsWith("image/")) {
        throw new AppError('The file must be an image', 400);
    }

    // Rota sem authMiddleware (autenticação gerenciada pelo front via cookie) —
    // usa o próprio id do colaborador como ator para o provenance do FileService.
    await useCases.updateEmployeePhoto(id, req.file, Number(id));

    respond.message(res, 'Photo saved successfully');
}

/**
 * Lista colaboradores paginados com filtros opcionais.
 *
 * Porta de `GET /GLOBAL/Controller/CCPP/Employee.php?pPage=1&pApplicationAccess=7`
 *
 * @route GET /employees
 * @access Requer `VIEW_EMPLOYEES`
 * @param {import('express').Request}  req - Query: pPage, pPageSize, pEmployeeName,
 *   pCompanyId, pShopId, pDepartmentId, pSubDepartmentId, pApplicationAccess
 * @param {import('express').Response} res
 */
async function getEmployees(req, res) {
    const result = await useCases.getEmployeesFiltered(req.query);
    return respond.ok(res, result);
}

/**
 * Lista usuários paginados com enriquecimento do Protheus.
 *
 * @route GET /users
 * @param {import('express').Request}  req - Query: pPage, pPageSize, pName, pApplicationId, pStatus
 * @param {import('express').Response} res
 */
async function getUsers(req, res) {
    const result = await useCases.getUsersFiltered(req.query);
    return respond.ok(res, result);
}

module.exports = {
    getPhotoEmployee,
    postPhotoEmployee,
    getEmployees,
    getUsers,
};
