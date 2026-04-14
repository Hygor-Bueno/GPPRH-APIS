const { AppError } = require("../../../errors/app.error");
const { Employee } = require("../services/employee.service");

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
    console.log("file:", req.file);
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

    res.json({
        error: false,
        message: "Photo saved successfully"
    });
}

module.exports = {
    getPhotoEmployee,
    postPhotoEmployee
};
