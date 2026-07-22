/**
 * @fileoverview Repositório MySQL para consulta de veículos GAPP (gapp_vehicle).
 *
 * Somente leitura — criação/atualização de veículo acontece via
 * gapp-active.repository.js (sp_gapp_save_active_v2), sempre atrelada a um ativo.
 *
 * @module modules/global/repositories/mysql/gapp-vehicle.repository
 */

const VEHICLE_FILTER_CLAUSES = {
    vehicle_id: 'v.vehicle_id = ?',
    active_id_fk: 'v.active_id_fk = ?',
    chassi: 'v.chassi = ?',
    renavam: 'v.renavam = ?',
    color: 'v.color LIKE ?',
    fuel_type_id_fk: 'v.fuel_type_id_fk = ?',
    year: 'v.year = ?',
    year_model: 'v.year_model = ?',
    directed_by: 'v.directed_by = ?',
    shielding: 'v.shielding = ?',
    status_active: 'a.status_active = ?',
    units_id_fk: 'a.units_id_fk = ?',
};

function buildVehicleFilters(filters = {}) {
    const conditions = [];
    const params = [];

    for (const [key, clause] of Object.entries(VEHICLE_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(key === 'color' ? `%${filters[key]}%` : filters[key]);
        }
    }

    if (filters.license_plates) {
        conditions.push('v.license_plates LIKE ?');
        params.push(`%${filters.license_plates}%`);
    }

    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function sqlListVehicles(filters = {}) {
    const { where, params } = buildVehicleFilters(filters);
    const limit = Number(filters.limit) || 20;
    const page = Number(filters.page) || 1;
    const offset = (page - 1) * limit;

    const sql = `
        SELECT v.vehicle_id, v.active_id_fk, v.license_plates, v.year, v.year_model, v.chassi,
               v.color, v.renavam, v.fuel_type, v.fuel_type_id_fk, v.power, v.cylinder, v.capacity,
               v.directed_by, v.shielding,
               a.brand, a.model, a.status_active, a.units_id_fk
        FROM global.gapp_vehicle v
        INNER JOIN global.gapp_active a ON v.active_id_fk = a.active_id
        ${where}
        ORDER BY v.vehicle_id DESC
        LIMIT ? OFFSET ?
    `;
    return { sql, params: [...params, limit, offset] };
}

function sqlCountVehicles(filters = {}) {
    const { where, params } = buildVehicleFilters(filters);
    const sql = `
        SELECT COUNT(*) AS total
        FROM global.gapp_vehicle v
        INNER JOIN global.gapp_active a ON v.active_id_fk = a.active_id
        ${where}
    `;
    return { sql, params };
}

function sqlGetVehicleById() {
    return `
        SELECT
            v.*,
            a.brand, a.model, a.number_nf, a.date_purchase, a.value_purchase, a.status_active,
            a.units_id_fk, a.id_active_class_fk, a.user_id_fk, a.work_group_fk
        FROM global.gapp_vehicle v
        INNER JOIN global.gapp_active a ON v.active_id_fk = a.active_id
        WHERE v.vehicle_id = ?
    `;
}

function sqlGetActiveInsuranceByVehicleId() {
    return `
        SELECT
            id_insurance, risk_cep, adjustment_factor, deductible_type,
            shielding, property_damage, bodily_damages, moral_damages,
            glasses, assist_24hrs, km_trailer, backup_car,
            policy_number, proposal_number, date_init, date_final,
            bodywork, IOF_value AS iof_value, insurance_value, deductible_value,
            form_payment, franchise_list, status_insurance,
            ins_id_fk, cov_id_fk, util_id_fk, vehicle_id_fk
        FROM global.gapp_insurance
        WHERE vehicle_id_fk = ? AND status_insurance = 1
    `;
}

module.exports = {
    sqlListVehicles, sqlCountVehicles, sqlGetVehicleById, sqlGetActiveInsuranceByVehicleId
};
