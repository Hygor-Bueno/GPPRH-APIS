const { AppError }                                      = require("../../../errors/app.error");
const { Employee, getEmployeesFiltered, getUsersFiltered } = require("../services/employee.service");
const { respond }                                         = require("../../../utils/respond");

async function getPhotoEmployee(req, res) {
    const { id } = req.params;
    if (!id || id == 0) {
        throw new AppError('Id is riquired', 400);
    }
    const employee = new Employee(id);
    const photo = await employee.getEmployeePhoto();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");

    res.send(photo);
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

    const employee = new Employee(id);
    await employee.updateEmployeePhoto(req.file.buffer);

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
    const result = await getEmployeesFiltered(req.query);
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
    const result = await getUsersFiltered(req.query);
    return respond.ok(res, result);
}

module.exports = {
    getPhotoEmployee,
    postPhotoEmployee,
    getEmployees,
    getUsers,
};
