const { GappSettingsUseCases } = require('../application/gapp/setting/gapp-setting.use-case.js');
const { MysqlSettingRepository } = require('../infrastructure/gapp/mysql-gapp-settings.repository.js');
const { MysqlGappUserRepository } = require('../infrastructure/gapp/mysql-gapp-user.repository');
const { respond } = require('../../../utils/respond');

const useCases = new GappSettingsUseCases({
    repository: new MysqlGappUserRepository(),
    userRepository: new MysqlGappUserRepository(),
});

// CREATES
async function createActiveType(req, res) {
    const result = await useCases.createActiveType(req.body, req.user);
    return respond.created(res, result);
}
async function createActiveClass(req, res) {
    const result = await useCases.createActiveClass(req.body, req.user);
    return respond.created(res, result);
}
async function createCompany(req, res) {
    const result = await useCases.createCompany(req.body, req.user);
    return respond.created(res, result);
}
async function createUnit(req, res) {
    const result = await useCases.createUnit(req.body, req.user);
    return respond.created(res, result);
}
async function createDepartament(req, res) {
    const result = await useCases.createDepartament(req.body, req.user);
    return respond.created(res, result);
}
async function createSubdepartament(req, res) {
    const result = await useCases.createSubdepartament(req.body, req.user);
    return respond.created(res, result);
}

// UPDATES
async function updateActiveType(req, res) {
    const result = await useCases.updateActiveType(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}
async function updateActiveClass(req, res) {
    const result = await useCases.updateActiveClass(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}
async function updateCompany(req, res) {
    const result = await useCases.updateCompany(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}
async function updateUnit(req, res) {
    const result = await useCases.updateUnit(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}
async function updateDepartament(req, res) {
    const result = await useCases.updateDepartament(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}
async function updateSubdepartament(req, res) {
    const result = await useCases.updateSubdepartament(Number(req.params.id), req.body, req.user);
    return respond.ok(res, result);
}

module.exports = {
    createActiveClass, createActiveType, createCompany,
    createUnit, createDepartament, createSubdepartament,
    updateActiveClass, updateActiveType, updateCompany,
    updateUnit, updateDepartament, updateSubdepartament
}