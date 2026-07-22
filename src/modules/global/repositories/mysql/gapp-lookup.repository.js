/**
 * @fileoverview Repositório MySQL para tabelas de apoio (lookup) do GAPP —
 * usadas para popular dropdowns/filtros nas telas de ativo e veículo.
 * Somente leitura, sem paginação (são tabelas pequenas de referência).
 *
 * @module modules/global/repositories/mysql/gapp-lookup.repository
 */

function sqlListUnits() {
    return 'SELECT * FROM global.gapp_units ORDER BY unit_name';
}

/**
 * Departamentos com unidade e empresa resolvidas — mesmo shape retornado pelo
 * legado (GLOBAL/Controller/GAPP/Departament.php?all=1).
 */
function sqlListDepartments() {
    return `
        SELECT
            d.dep_id,
            d.dep_name,
            d.status_dep,
            d.unit_id_fk,
            u.unit_id,
            u.unit_number,
            u.address,
            u.unit_name,
            u.cnpj,
            u.status_unit,
            u.comp_id_fk,
            c.comp_id,
            c.corporate_name,
            c.fantasy_name,
            c.status_comp,
            CONCAT(c.fantasy_name, ' > ', u.unit_name, ' > ', d.dep_name) AS full_description
        FROM global.gapp_departaments d
        LEFT JOIN global.gapp_units   u ON u.unit_id = d.unit_id_fk
        LEFT JOIN global.gapp_company c ON c.comp_id = u.comp_id_fk
        ORDER BY full_description
    `;
}

function sqlListActiveClass() {
    return 'SELECT * FROM global.gapp_active_class ORDER BY desc_active_class';
}

function sqlListWorkGroup() {
    return 'SELECT * FROM global.gapp_work_group ORDER BY group_name';
}

function sqlListDriver() {
    return 'SELECT * FROM global.gapp_driver';
}

function sqlListFuelType() {
    return 'SELECT * FROM global.gapp_fuel_type ORDER BY description';
}

function sqlListUser() {
    return 'SELECT * FROM global.gapp_user ORDER BY name';
}

// ─── FKs de gapp_insurance (ins_id_fk, cov_id_fk, util_id_fk) ─────────────────

function sqlListInsuranceCompany() {
    return 'SELECT * FROM global.gapp_insurance_company ORDER BY ins_name';
}

function sqlListTypeCoverage() {
    return 'SELECT * FROM global.gapp_type_coverage ORDER BY cov_name';
}

function sqlListUtilization() {
    return 'SELECT * FROM global.gapp_utilization ORDER BY util_name';
}

// ─── FKs de despesas (gapp_sinister.damage_type_id_fk, gapp_fines.infraction_id_fk) ──

function sqlListDamageType() {
    return 'SELECT * FROM global.gapp_damage_type ORDER BY description';
}

function sqlListInfractions() {
    return 'SELECT * FROM global.gapp_infractions ORDER BY infraction';
}

module.exports = {
    sqlListUnits, sqlListActiveClass, sqlListWorkGroup,
    sqlListDriver, sqlListFuelType, sqlListUser,
    sqlListInsuranceCompany, sqlListTypeCoverage, sqlListUtilization,
    sqlListDepartments, sqlListDamageType, sqlListInfractions
};
