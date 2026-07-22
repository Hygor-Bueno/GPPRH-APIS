/**
 * @fileoverview Repositório MySQL para ativos GAPP (gapp_active/gapp_vehicle).
 *
 * Todas as queries usam placeholders (?) para evitar SQL injection —
 * diferente do DAO PHP legado, que montava a CALL via addslashes()/concatenação.
 *
 * @module modules/global/repositories/mysql/gapp-active.repository
 */

function sqlSaveActive() {
    const placeholders = Array(36).fill('?').join(', ');
    return `CALL sp_gapp_save_active_v2(${placeholders}, @p_active_id_out, @p_id_insurance_out)`;
}

function sqlSelectActiveIdOut() {
    return 'SELECT @p_active_id_out AS id, @p_id_insurance_out AS insurance_id';
}

/**
 * Monta, na ordem exata da procedure, os 36 parâmetros de entrada
 * (35 de ativo/veículo + 1 JSON de seguro opcional).
 */
function buildSaveActiveParams(data) {
    const vehicle = data.vehicle || {};

    return [
        data.active_id ?? null,

        // ===== ATIVO =====
        data.brand ?? null,
        data.model ?? null,
        data.number_nf ?? null,
        data.date_purchase ?? null,
        data.place_purchase != null ? JSON.stringify(data.place_purchase) : null,
        data.value_purchase ?? null,
        data.photo ?? null,
        data.change_date ?? null,
        data.list_items != null ? JSON.stringify(data.list_items) : null,
        data.used_in ?? null,
        data.is_vehicle ?? null,
        data.status_active ?? null,
        data.units_id_fk ?? null,
        data.id_active_class_fk ?? null,
        data.user_id_fk ?? null,
        data.work_group_fk ?? null,

        // ===== VEÍCULO =====
        vehicle.license_plates ?? null,
        vehicle.year ?? null,
        vehicle.year_model ?? null,
        vehicle.chassi ?? null,
        vehicle.color ?? null,
        vehicle.renavam ?? null,
        vehicle.fuel_type ?? null,
        vehicle.power ?? null,
        vehicle.cylinder ?? null,
        vehicle.capacity ?? null,
        vehicle.fipe_table ?? null,
        vehicle.last_revision_date ?? null,
        vehicle.last_revision_km ?? null,
        vehicle.next_revision_date ?? null,
        vehicle.next_revision_km ?? null,
        vehicle.directed_by ?? null,
        vehicle.shielding ?? null,
        vehicle.fuel_type_id_fk ?? null,

        // ===== SEGURO (opcional) =====
        // Objeto vazio ({}) conta como "sem seguro" — senão a procedure
        // recebe um JSON não-nulo e tenta gravar todos os campos como NULL.
        data.insurance && Object.keys(data.insurance).length > 0 ? JSON.stringify(data.insurance) : null
    ];
}

// ─── Consulta (GET) ─────────────────────────────────────────────────

const ACTIVE_FILTER_CLAUSES = {
    active_id: 'a.active_id = ?',
    brand: 'a.brand LIKE ?',
    model: 'a.model LIKE ?',
    number_nf: 'a.number_nf = ?',
    is_vehicle: 'a.is_vehicle = ?',
    status_active: 'a.status_active = ?',
    units_id_fk: 'a.units_id_fk = ?',
    id_active_class_fk: 'a.id_active_class_fk = ?',
    user_id_fk: 'a.user_id_fk = ?',
    work_group_fk: 'a.work_group_fk = ?',
    used_in: 'a.used_in = ?',
};

function buildActiveFilters(filters = {}) {
    const conditions = [];
    const params = [];

    for (const [key, clause] of Object.entries(ACTIVE_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(key === 'brand' || key === 'model' ? `%${filters[key]}%` : filters[key]);
        }
    }

    if (filters.date_purchase_from) {
        conditions.push('a.date_purchase >= ?');
        params.push(filters.date_purchase_from);
    }
    if (filters.date_purchase_to) {
        conditions.push('a.date_purchase <= ?');
        params.push(filters.date_purchase_to);
    }

    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function sqlListActive(filters = {}) {
    const { where, params } = buildActiveFilters(filters);
    const limit = Number(filters.limit) || 20;
    const page = Number(filters.page) || 1;
    const offset = (page - 1) * limit;

    const sql = `
        SELECT a.active_id, a.brand, a.model, a.number_nf, a.date_purchase, a.value_purchase,
               a.photo, a.is_vehicle, a.status_active, a.units_id_fk, a.id_active_class_fk,
               a.user_id_fk, a.work_group_fk, a.used_in, a.change_date, a.created_at
        FROM global.gapp_active a
        ${where}
        ORDER BY a.active_id DESC
        LIMIT ? OFFSET ?
    `;
    return { sql, params: [...params, limit, offset] };
}

function sqlCountActive(filters = {}) {
    const { where, params } = buildActiveFilters(filters);
    return { sql: `SELECT COUNT(*) AS total FROM global.gapp_active a ${where}`, params };
}

/**
 * `work_group_fk` é obrigatório e vem sempre do usuário autenticado (nunca
 * do cliente) — garante que não dá pra buscar por ID um ativo de outro
 * grupo de trabalho.
 */
function sqlGetActiveById() {
    return `
        SELECT
            a.*,
            u.unit_name, u.unit_number, u.cnpj AS unit_cnpj, u.status_unit,
            ac.desc_active_class, ac.status_active_class,
            usr.name AS user_name, usr.access_code AS user_access_code,
            wg.group_name, wg.status_work_group
        FROM global.gapp_active a
        LEFT JOIN global.gapp_units u ON a.units_id_fk = u.unit_id
        LEFT JOIN global.gapp_active_class ac ON a.id_active_class_fk = ac.id_active_class
        LEFT JOIN global.gapp_user usr ON a.user_id_fk = usr.user_id
        LEFT JOIN global.gapp_work_group wg ON a.work_group_fk = wg.group_id
        WHERE a.active_id = ? AND a.work_group_fk = ?
    `;
}

function sqlGetVehicleByActiveId() {
    return 'SELECT * FROM global.gapp_vehicle WHERE active_id_fk = ?';
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

/**
 * Resolve o gapp_user.user_id e o work_group_fk (via gapp_level) do usuário
 * autenticado a partir do `id` (_user.id) que vem no JWT — usado para
 * preencher `user_id_fk`/`work_group_fk` sozinho, sem depender do que o
 * cliente mandar no body.
 */
function sqlGetUserAuthByAccessCode() {
    return `
        SELECT
            u.user_id,
            l.group_id_fk AS work_group_fk
        FROM global.gapp_user u
        INNER JOIN global.gapp_level l ON l.level_id = u.level_id_fk
        WHERE u.access_code = ?
    `;
}

/**
 * Retorna o `is_vehicle` atual do ativo, restrito ao work_group_fk do
 * usuário — usado no PUT quando o cliente não reenvia esse campo, pra não
 * sobrescrever o valor existente com um default arbitrário.
 */
function sqlGetIsVehicleByActiveId() {
    return 'SELECT is_vehicle FROM global.gapp_active WHERE active_id = ? AND work_group_fk = ?';
}

module.exports = {
    sqlSaveActive, sqlSelectActiveIdOut, buildSaveActiveParams,
    sqlListActive, sqlCountActive, sqlGetActiveById,
    sqlGetVehicleByActiveId, sqlGetActiveInsuranceByVehicleId,
    sqlGetUserAuthByAccessCode, sqlGetIsVehicleByActiveId
};
