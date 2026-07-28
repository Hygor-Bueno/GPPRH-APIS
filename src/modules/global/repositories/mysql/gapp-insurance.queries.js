/**
 * @fileoverview Repositório MySQL para seguro GAPP (gapp_insurance), uso standalone.
 *
 * Chama `sp_gapp_save_insurance` — mesma procedure (via a worker interna
 * `sp_gapp_save_insurance_worker`) usada pela gravação atômica de
 * ativo+veículo+seguro em gapp-active.repository.js. Uma única fonte de
 * verdade da lógica de negócio do seguro.
 *
 * @module modules/global/repositories/mysql/gapp-insurance.queries
 */

function sqlSaveInsurance() {
    const placeholders = Array(29).fill('?').join(', ');
    return `CALL sp_gapp_save_insurance(${placeholders}, @p_id_insurance_out)`;
}

function sqlSelectInsuranceIdOut() {
    return 'SELECT @p_id_insurance_out AS id';
}

/**
 * Monta, na ordem exata da procedure, os 29 parâmetros.
 * `data.is_update` é definido pelo controller (0 = POST/criar, 1 = PUT/editar),
 * não vem do body do cliente.
 *
 * Campos descontinuados (removidos da procedure, substituídos por
 * franchise_list): bodywork_vehicle, hull, accessories,
 * windshield, conventional_headlight, conventional_flashlight,
 * xenon_led_headlight, xenon_flashlight, rear_view, auxiliary_headlight.
 * `backup_car` NÃO é descontinuado — segue como campo ativo (INT).
 */
function buildSaveInsuranceParams(data) {
    return [
        data.id_insurance ?? null,
        data.is_update ?? 0,
        data.vehicle_id_fk ?? null,
        data.risk_cep ?? null,
        data.adjustment_factor ?? null,
        data.deductible_type ?? null,
        data.equipament ?? null,
        data.shielding ?? null,
        data.property_damage ?? null,
        data.bodily_damages ?? null,
        data.moral_damages ?? null,
        data.glasses ?? null,
        data.assist_24hrs ?? null,
        data.km_trailer ?? null,
        data.policy_number ?? null,
        data.proposal_number ?? null,
        data.date_init ?? null,
        data.date_final ?? null,
        data.bodywork ?? null,
        data.iof_value ?? null,
        data.insurance_value ?? null,
        data.deductible_value ?? null,
        data.form_payment ?? null,
        data.franchise_list != null ? JSON.stringify(data.franchise_list) : null,
        data.status_insurance ?? null,
        data.ins_id_fk ?? null,
        data.cov_id_fk ?? null,
        data.util_id_fk ?? null,
        data.backup_car ?? null
    ];
}

// ─── Consulta (GET) ─────────────────────────────────────────────────

const INSURANCE_FILTER_CLAUSES = {
    id_insurance: 'i.id_insurance = ?',
    vehicle_id_fk: 'i.vehicle_id_fk = ?',
    status_insurance: 'i.status_insurance = ?',
    ins_id_fk: 'i.ins_id_fk = ?',
    cov_id_fk: 'i.cov_id_fk = ?',
    util_id_fk: 'i.util_id_fk = ?',
    policy_number: 'i.policy_number = ?',
    proposal_number: 'i.proposal_number = ?',
    // work_group_fk é resolvido do usuário autenticado, nunca da query string.
    work_group_fk: 'a.work_group_fk = ?',
};

function buildInsuranceFilters(filters = {}) {
    const conditions = [];
    const params = [];

    for (const [key, clause] of Object.entries(INSURANCE_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(filters[key]);
        }
    }

    if (filters.date_init_from) { conditions.push('i.date_init >= ?'); params.push(filters.date_init_from); }
    if (filters.date_init_to)   { conditions.push('i.date_init <= ?'); params.push(filters.date_init_to); }
    if (filters.date_final_from) { conditions.push('i.date_final >= ?'); params.push(filters.date_final_from); }
    if (filters.date_final_to)   { conditions.push('i.date_final <= ?'); params.push(filters.date_final_to); }

    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function sqlListInsurance(filters = {}) {
    const { where, params } = buildInsuranceFilters(filters);
    const limit = Number(filters.limit) || 20;
    const page = Number(filters.page) || 1;
    const offset = (page - 1) * limit;

    const sql = `
        SELECT i.id_insurance, i.vehicle_id_fk, i.ins_id_fk, i.cov_id_fk, i.util_id_fk,
               i.status_insurance, i.risk_cep, i.policy_number, i.proposal_number,
               i.date_init, i.date_final, i.insurance_value, i.deductible_value, i.form_payment,
               v.license_plates
        FROM global.gapp_insurance i
        LEFT JOIN global.gapp_vehicle v ON i.vehicle_id_fk = v.vehicle_id
        LEFT JOIN global.gapp_active a ON v.active_id_fk = a.active_id
        ${where}
        ORDER BY i.id_insurance DESC
        LIMIT ? OFFSET ?
    `;
    return { sql, params: [...params, limit, offset] };
}

function sqlCountInsurance(filters = {}) {
    const { where, params } = buildInsuranceFilters(filters);
    return {
        sql: `
            SELECT COUNT(*) AS total
            FROM global.gapp_insurance i
            LEFT JOIN global.gapp_vehicle v ON i.vehicle_id_fk = v.vehicle_id
            LEFT JOIN global.gapp_active a ON v.active_id_fk = a.active_id
            ${where}
        `,
        params
    };
}

/**
 * `work_group_fk` é obrigatório e vem sempre do usuário autenticado (nunca
 * do cliente) — garante que não dá pra buscar por ID um seguro de veículo
 * de outro grupo de trabalho.
 */
function sqlGetInsuranceById() {
    return `
        SELECT
            i.id_insurance, i.risk_cep, i.adjustment_factor, i.deductible_type,
            i.shielding, i.property_damage, i.bodily_damages, i.moral_damages,
            i.glasses, i.assist_24hrs, i.km_trailer, i.backup_car,
            i.policy_number, i.proposal_number, i.date_init, i.date_final,
            i.bodywork, i.IOF_value AS iof_value, i.insurance_value, i.deductible_value,
            i.form_payment, i.franchise_list, i.status_insurance,
            i.ins_id_fk, i.cov_id_fk, i.util_id_fk, i.vehicle_id_fk,
            ic.ins_name, ic.ins_cnpj, ic.status_ins_comp,
            tc.cov_name, tc.status_cov,
            ut.util_name, ut.status_util,
            v.license_plates, v.active_id_fk
        FROM global.gapp_insurance i
        LEFT JOIN global.gapp_insurance_company ic ON i.ins_id_fk = ic.ins_id
        LEFT JOIN global.gapp_type_coverage tc ON i.cov_id_fk = tc.cov_id
        LEFT JOIN global.gapp_utilization ut ON i.util_id_fk = ut.util_id
        LEFT JOIN global.gapp_vehicle v ON i.vehicle_id_fk = v.vehicle_id
        LEFT JOIN global.gapp_active a ON v.active_id_fk = a.active_id
        WHERE i.id_insurance = ? AND a.work_group_fk = ?
    `;
}

/**
 * Resolve o work_group_fk do veículo (via o ativo ao qual pertence) — usado
 * para validar ownership antes de CRIAR uma apólice pra um veículo.
 */
function sqlGetVehicleWorkGroupByVehicleId() {
    return `
        SELECT a.work_group_fk
        FROM global.gapp_vehicle v
        INNER JOIN global.gapp_active a ON v.active_id_fk = a.active_id
        WHERE v.vehicle_id = ?
    `;
}

/**
 * Resolve o work_group_fk do veículo dono de uma apólice existente — usado
 * para validar ownership antes de ATUALIZAR uma apólice.
 */
function sqlGetVehicleWorkGroupByInsuranceId() {
    return `
        SELECT a.work_group_fk
        FROM global.gapp_insurance i
        INNER JOIN global.gapp_vehicle v ON i.vehicle_id_fk = v.vehicle_id
        INNER JOIN global.gapp_active a ON v.active_id_fk = a.active_id
        WHERE i.id_insurance = ?
    `;
}

/**
 * Retorna o seguro ativo (status_insurance = 1) de um veículo.
 *
 * Consolidada aqui: antes existia duplicada byte-a-byte em
 * `gapp-active.repository.js` e `gapp-vehicle.repository.js` — agora só
 * existe neste arquivo, único dono da lógica de negócio de seguro.
 */
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
    sqlSaveInsurance, sqlSelectInsuranceIdOut, buildSaveInsuranceParams,
    sqlListInsurance, sqlCountInsurance, sqlGetInsuranceById,
    sqlGetActiveInsuranceByVehicleId,
    sqlGetVehicleWorkGroupByVehicleId, sqlGetVehicleWorkGroupByInsuranceId
};
