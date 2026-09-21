function sqlInsertActiveType() {
    return `INSERT INTO global.gapp_active_type (
	            desc_acitve_type, date_active_type, status_active_type, group_id_fk
            ) VALUES (?, ?, ?, ?)`
}

function buildInsertActiveType(data) {
    return [
        data.desc_acitve_type ?? null,
        data.date_active_type ?? null,
        data.status_active_type ?? null,
        data.group_id_fk ?? null
    ]
}

function sqlInsertActiveClass() {
    return `INSERT INTO global.gapp_active_class (
                desc_active_class, status_active_class, active_type_id_fk
            ) VALUES (?, ?, ?)`
}

function buildInsertActiveClass(data) {
    return [
        data.desc_active_class ?? null,
        data.status_active_class ?? null,
        data.active_type_id_fk ?? null
    ]
}

function sqlInsertCompany() {
    return `INSERT INTO global.gapp_company (
                corporate_name, fantasy_name, status_comp
            ) VALUES (?, ?, ?)`
}

function buildInsertCompany(data) {
    return [
        data.corporate_name ?? null,
        data.fantasy_name ?? null,
        data.status_comp ?? null
    ]
}

function sqlInsertUnit() {
    return `INSERT INTO global.gapp_units (
                unit_number, address, unit_name, cnpj, status_unit, comp_id_fk
            ) VALUES (?, ?, ?, ?, ?, ?)`
}

function buildInsertUnit(data) {
    return [
        data.unit_number ?? null,
        data.address ?? null,
        data.unit_name ?? null,
        data.cnpj ?? null,
        data.status_unit ?? null,
        data.comp_id_fk ?? null
    ]
}

function sqlInsertDepartament() {
    return `INSERT INTO global.gapp_departaments (dep_name, status_dep, unit_id_fk) VALUES (?, ?, ?)`
}

function buildInsertDepartament(data) {
    return [
        data.dep_name ?? null,
        data.status_dep ?? null,
        data.unit_id_fk ?? null
    ]
}

function sqlInsertSubdepartament() {
    return `INSERT INTO global.gapp_subdepartament (sub_dep_name, status_sub_dep, dep_id_fk) VALUES (?, ?, ?)`
}

function buildInsertSubdepartment(data) {
    return [
        data.sub_dep_name ?? null,
        data.status_sub_dep ?? null,
        data.dep_id_fk ?? null
    ]

}

module.exports = {
    sqlInsertActiveClass,
    sqlInsertActiveType,
    sqlInsertCompany,
    sqlInsertUnit,
    sqlInsertDepartament,
    sqlInsertSubdepartament,
    buildInsertActiveClass,
    buildInsertActiveType,
    buildInsertCompany,
    buildInsertUnit,
    buildInsertDepartament,
    buildInsertSubdepartment
}