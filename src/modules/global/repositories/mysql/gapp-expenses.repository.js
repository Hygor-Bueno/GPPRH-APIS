/**
 * @fileoverview Repositório MySQL para despesas de ativos GAPP
 * (gapp_expenses_register / gapp_expenses_type).
 *
 * Escrita via INSERT/UPDATE parametrizado direto (sem stored procedure) —
 * diferente de active/insurance, não há aqui lógica multi-tabela/transação
 * complexa que justifique uma procedure.
 *
 * @module modules/global/repositories/mysql/gapp-expenses.repository
 */

// ─── Escrita ───────────────────────────────────────────────────────────────

function sqlInsertExpense() {
    return `
        INSERT INTO global.gapp_expenses_register
            (date, hour, local, description, total_value, discount, provider,
             exp_type_id_fk, driver_id_fk, active_id_fk, user_id_fk,
             coupon_number, store_id_fk)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
}

function buildInsertExpenseParams(data) {
    return [
        data.date,
        data.hour,
        data.local != null ? JSON.stringify(data.local) : null,
        data.description,
        data.total_value,
        data.discount ?? 0,
        data.provider ?? null,
        data.exp_type_id_fk,
        data.driver_id_fk ?? null,
        data.active_id_fk ?? null,
        data.user_id_fk,
        data.coupon_number ?? 0,
        data.store_id_fk ?? null
    ];
}

function sqlUpdateExpense() {
    return `
        UPDATE global.gapp_expenses_register
        SET
            date            = ?,
            hour            = ?,
            local           = ?,
            description     = ?,
            total_value     = ?,
            discount        = ?,
            provider        = ?,
            exp_type_id_fk  = ?,
            driver_id_fk    = ?,
            active_id_fk    = ?,
            coupon_number   = ?,
            store_id_fk     = ?,
            status_expen    = ?
        WHERE expen_id = ?
    `;
}

function buildUpdateExpenseParams(data) {
    return [
        data.date,
        data.hour,
        data.local != null ? JSON.stringify(data.local) : null,
        data.description,
        data.total_value,
        data.discount ?? 0,
        data.provider ?? null,
        data.exp_type_id_fk,
        data.driver_id_fk ?? null,
        data.active_id_fk ?? null,
        data.coupon_number ?? 0,
        data.store_id_fk ?? null,
        data.status_expen ?? 1,
        data.expen_id
    ];
}

/**
 * Resolve o work_group_fk de um ativo — usado para validar, antes de
 * criar/atualizar uma despesa, que o `active_id_fk` informado pertence ao
 * grupo de trabalho do usuário autenticado.
 */
function sqlGetActiveWorkGroup() {
    return 'SELECT work_group_fk FROM global.gapp_active WHERE active_id = ?';
}

/**
 * Resolve o vehicle_id do veículo vinculado a um ativo — usado pra despesa
 * do tipo Seguro, que precisa do vehicle_id_fk de gapp_insurance mas só
 * recebe o active_id_fk da despesa (mesmo padrão de sp_gapp_save_active_v2).
 */
function sqlGetVehicleIdByActiveId() {
    return 'SELECT vehicle_id FROM global.gapp_vehicle WHERE active_id_fk = ?';
}

// ─── Escrita — especificações por tipo de despesa ──────────────────────────
//
// Cada função grava na tabela de detalhe do tipo, sempre linkando de volta
// pra despesa via expen_id_fk. Chamadas pelo service dentro da mesma
// transação do INSERT/UPDATE em gapp_expenses_register.

function sqlInsertFuel() {
    return `
        INSERT INTO global.gapp_fuel
            (liter_value, coupon_number, km_day, liter_qtd, expen_id_fk,
             fuel_type_id_fk, item_number, detail)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
}

function buildInsertFuelParams(data, expenId) {
    return [
        data.liter_value,
        data.coupon_number ?? null,
        data.km_day,
        data.liter_qtd,
        expenId,
        data.fuel_type_id_fk ?? 1,
        data.item_number ?? 1,
        data.detail ?? 'Abastecimento'
    ];
}

function sqlInsertMaintenance() {
    return `
        INSERT INTO global.gapp_maintenance
            (technician, service_value, list_parts, value_parts, km_day,
             km_next, date_next, warranty, validity, expen_id_fk)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
}

function buildInsertMaintenanceParams(data, expenId) {
    return [
        data.technician ?? null,
        data.service_value ?? null,
        data.list_parts != null ? JSON.stringify(data.list_parts) : null,
        data.value_parts ?? 0,
        data.km_day,
        data.km_next ?? null,
        data.date_next ?? null,
        data.warranty ?? 0,
        data.validity ?? null,
        expenId
    ];
}

/**
 * `id_insurance_fk` referencia uma apólice já existente — sinistro nunca
 * cria apólice nova, só documenta um evento sobre uma que já existe.
 */
function sqlInsertSinister() {
    return `
        INSERT INTO global.gapp_sinister
            (guilty, victim, finished, others_documents, data_third, bo_number,
             bo_receipt_date, bo_shipping_date, observation, damage_type_id_fk,
             expen_id_fk, id_insurance_fk)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
}

function buildInsertSinisterParams(data, expenId) {
    return [
        data.guilty,
        data.victim ?? 0,
        data.finished ?? null,
        data.others_documents ?? null,
        data.data_third ?? null,
        data.bo_number ?? null,
        data.bo_receipt_date ?? null,
        data.bo_shipping_date ?? null,
        data.observation,
        data.damage_type_id_fk,
        expenId,
        data.id_insurance_fk
    ];
}

function sqlInsertFine() {
    return `
        INSERT INTO global.gapp_fines
            (infraction, ait, gravity, points, article_ctb,
             offending_driver_date, offending_driver, expen_id_fk, infraction_id_fk)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
}

function buildInsertFineParams(data, expenId) {
    return [
        data.infraction,
        data.ait,
        data.gravity,
        data.points,
        data.article_ctb,
        data.offending_driver_date,
        data.offending_driver,
        expenId,
        data.infraction_id_fk ?? null
    ];
}

/**
 * Vincula a apólice recém-criada/atualizada (via sp_gapp_save_insurance) à
 * despesa — a procedure não seta expen_id_fk sozinha, então fazemos isso
 * depois, dentro da mesma transação.
 */
function sqlLinkInsuranceToExpense() {
    return 'UPDATE global.gapp_insurance SET expen_id_fk = ? WHERE id_insurance = ?';
}

/**
 * Resolve a apólice já vinculada a uma despesa (se houver) — usado no
 * update pra saber se o Seguro deve ser atualizado in-place (is_update=1)
 * em vez de criar uma apólice nova a cada edição.
 */
function sqlGetInsuranceIdByExpenseId() {
    return 'SELECT id_insurance FROM global.gapp_insurance WHERE expen_id_fk = ?';
}

/**
 * Tipo atual da despesa — usado no update pra recusar troca de
 * exp_type_id_fk (regra de negócio: tipo é definitivo após o cadastro).
 */
function sqlGetExpenseType() {
    return 'SELECT exp_type_id_fk FROM global.gapp_expenses_register WHERE expen_id = ?';
}

// ─── Escrita — atualização do detalhe (usado só no update) ────────────────
//
// exp_type_id_fk nunca muda depois de criado (regra de negócio, garantida
// pelo service), então a linha de detalhe sempre existe na tabela do tipo
// atual — por isso aqui é UPDATE direto, não precisa de delete+insert.

function sqlUpdateFuel() {
    return `
        UPDATE global.gapp_fuel
        SET
            liter_value     = ?,
            coupon_number   = ?,
            km_day          = ?,
            liter_qtd       = ?,
            fuel_type_id_fk = ?,
            item_number     = ?,
            detail          = ?
        WHERE expen_id_fk = ?
    `;
}

function buildUpdateFuelParams(data, expenId) {
    return [
        data.liter_value,
        data.coupon_number ?? null,
        data.km_day,
        data.liter_qtd,
        data.fuel_type_id_fk ?? 1,
        data.item_number ?? 1,
        data.detail ?? 'Abastecimento',
        expenId
    ];
}

function sqlUpdateMaintenance() {
    return `
        UPDATE global.gapp_maintenance
        SET
            technician    = ?,
            service_value = ?,
            list_parts    = ?,
            value_parts   = ?,
            km_day        = ?,
            km_next       = ?,
            date_next     = ?,
            warranty      = ?,
            validity      = ?
        WHERE expen_id_fk = ?
    `;
}

function buildUpdateMaintenanceParams(data, expenId) {
    return [
        data.technician ?? null,
        data.service_value ?? null,
        data.list_parts != null ? JSON.stringify(data.list_parts) : null,
        data.value_parts ?? 0,
        data.km_day,
        data.km_next ?? null,
        data.date_next ?? null,
        data.warranty ?? 0,
        data.validity ?? null,
        expenId
    ];
}

function sqlUpdateSinister() {
    return `
        UPDATE global.gapp_sinister
        SET
            guilty             = ?,
            victim             = ?,
            finished           = ?,
            others_documents   = ?,
            data_third         = ?,
            bo_number          = ?,
            bo_receipt_date    = ?,
            bo_shipping_date   = ?,
            observation        = ?,
            damage_type_id_fk  = ?,
            id_insurance_fk    = ?
        WHERE expen_id_fk = ?
    `;
}

function buildUpdateSinisterParams(data, expenId) {
    return [
        data.guilty,
        data.victim ?? 0,
        data.finished ?? null,
        data.others_documents ?? null,
        data.data_third ?? null,
        data.bo_number ?? null,
        data.bo_receipt_date ?? null,
        data.bo_shipping_date ?? null,
        data.observation,
        data.damage_type_id_fk,
        data.id_insurance_fk,
        expenId
    ];
}

function sqlUpdateFine() {
    return `
        UPDATE global.gapp_fines
        SET
            infraction             = ?,
            ait                    = ?,
            gravity                = ?,
            points                 = ?,
            article_ctb            = ?,
            offending_driver_date  = ?,
            offending_driver       = ?,
            infraction_id_fk       = ?
        WHERE expen_id_fk = ?
    `;
}

function buildUpdateFineParams(data, expenId) {
    return [
        data.infraction,
        data.ait,
        data.gravity,
        data.points,
        data.article_ctb,
        data.offending_driver_date,
        data.offending_driver,
        data.infraction_id_fk ?? null,
        expenId
    ];
}

// ─── Consulta (GET) — despesas de qualquer ativo ───────────────────────────

const EXPENSE_FILTER_CLAUSES = {
    expen_id: 'reg.expen_id = ?',
    hour: 'reg.hour = ?',
    active_id_fk: 'reg.active_id_fk = ?',
    exp_type_id_fk: 'reg.exp_type_id_fk = ?',
    description: 'reg.description LIKE ?',
    status_expen: 'reg.status_expen = ?',
};

function buildExpenseFilters(filters = {}) {
    const conditions = ['act.work_group_fk = ?'];
    const params = [filters.work_group_fk];

    for (const [key, clause] of Object.entries(EXPENSE_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(key === 'description' ? `%${filters[key]}%` : filters[key]);
        }
    }

    if (filters.date_start) { conditions.push('reg.date >= ?'); params.push(filters.date_start); }
    if (filters.date_end)   { conditions.push('reg.date <= ?'); params.push(filters.date_end); }

    return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

function sqlListExpenses(filters = {}) {
    const { where, params } = buildExpenseFilters(filters);
    const limit = Number(filters.limit) || 20;
    const page = Number(filters.page) || 1;
    const offset = (page - 1) * limit;

    const sql = `
        SELECT
            reg.expen_id, reg.date, reg.hour, reg.local, reg.description,
            reg.total_value, reg.discount, reg.provider, reg.exp_type_id_fk,
            exp.description_type, reg.driver_id_fk, reg.active_id_fk,
            reg.user_id_fk, reg.status_expen, reg.coupon_number,
            reg.store_id_fk, reg.created_at, reg.updated_at
        FROM global.gapp_expenses_register reg
        INNER JOIN global.gapp_active act ON reg.active_id_fk = act.active_id
        LEFT JOIN global.gapp_expenses_type exp ON exp.exp_type_id = reg.exp_type_id_fk
        ${where}
        ORDER BY reg.expen_id DESC
        LIMIT ? OFFSET ?
    `;
    return { sql, params: [...params, limit, offset] };
}

function sqlCountExpenses(filters = {}) {
    const { where, params } = buildExpenseFilters(filters);
    return {
        sql: `
            SELECT COUNT(*) AS total
            FROM global.gapp_expenses_register reg
            INNER JOIN global.gapp_active act ON reg.active_id_fk = act.active_id
            ${where}
        `,
        params
    };
}

// ─── Consulta (GET) — despesas de veículo (placa, unidade) ─────────────────
//
// Baseada na pcr_select_filtered_expenses (legado) — mesmos filtros,
// acrescentando o isolamento por work_group_fk (o legado não tinha).
// Só retorna despesas de ativos que são veículo (INNER JOIN gapp_vehicle).

const VEHICLE_EXPENSE_FILTER_CLAUSES = {
    expen_id: 'reg.expen_id = ?',
    hour: 'reg.hour = ?',
    exp_type_id_fk: 'reg.exp_type_id_fk = ?',
    description: 'reg.description LIKE ?',
    discount: 'reg.discount = ?',
    total_value: 'reg.total_value = ?',
    status_expen: 'reg.status_expen = ?',
    vehicle_id: 'vcl.vehicle_id = ?',
    license_plates: 'vcl.license_plates LIKE ?',
    unit_id: 'st.unit_id = ?',
    unit_name: 'st.unit_name LIKE ?',
};

const VEHICLE_EXPENSE_LIKE_FIELDS = new Set(['description', 'license_plates', 'unit_name']);

function buildVehicleExpenseFilters(filters = {}) {
    const conditions = ['act.work_group_fk = ?'];
    const params = [filters.work_group_fk];

    for (const [key, clause] of Object.entries(VEHICLE_EXPENSE_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(VEHICLE_EXPENSE_LIKE_FIELDS.has(key) ? `%${filters[key]}%` : filters[key]);
        }
    }

    if (filters.date_start) { conditions.push('reg.date >= ?'); params.push(filters.date_start); }
    if (filters.date_end)   { conditions.push('reg.date <= ?'); params.push(filters.date_end); }

    return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

function sqlListVehicleExpenses(filters = {}) {
    const { where, params } = buildVehicleExpenseFilters(filters);
    const limit = Number(filters.limit) || 50;
    const page = Number(filters.page) || 1;
    const offset = (page - 1) * limit;

    const sql = `
        SELECT
            reg.expen_id, reg.date, reg.hour, reg.description, reg.discount,
            reg.total_value, reg.exp_type_id_fk, exp.description_type,
            vcl.vehicle_id, vcl.license_plates, st.unit_id, st.unit_name
        FROM global.gapp_expenses_register reg
        INNER JOIN global.gapp_active act ON reg.active_id_fk = act.active_id
        INNER JOIN global.gapp_units st ON act.units_id_fk = st.unit_id
        INNER JOIN global.gapp_vehicle vcl ON reg.active_id_fk = vcl.active_id_fk
        INNER JOIN global.gapp_expenses_type exp ON exp.exp_type_id = reg.exp_type_id_fk
        ${where}
        ORDER BY reg.expen_id DESC
        LIMIT ? OFFSET ?
    `;
    return { sql, params: [...params, limit, offset] };
}

function sqlCountVehicleExpenses(filters = {}) {
    const { where, params } = buildVehicleExpenseFilters(filters);
    return {
        sql: `
            SELECT COUNT(*) AS total
            FROM global.gapp_expenses_register reg
            INNER JOIN global.gapp_active act ON reg.active_id_fk = act.active_id
            INNER JOIN global.gapp_units st ON act.units_id_fk = st.unit_id
            INNER JOIN global.gapp_vehicle vcl ON reg.active_id_fk = vcl.active_id_fk
            INNER JOIN global.gapp_expenses_type exp ON exp.exp_type_id = reg.exp_type_id_fk
            ${where}
        `,
        params
    };
}

// ─── Consulta (GET) — detalhe completo por id ──────────────────────────────
//
// LEFT JOIN em todas as 5 tabelas de especificação — só a do exp_type_id_fk
// da despesa vem preenchida, as outras 4 vêm tudo NULL. O service usa isso
// pra montar o objeto aninhado (fuel/maintenance/sinister/fine/insurance).

function sqlGetExpenseById() {
    return `
        SELECT
            reg.expen_id, reg.date, reg.hour, reg.local, reg.description,
            reg.total_value, reg.discount, reg.provider, reg.exp_type_id_fk,
            expt.description_type, reg.driver_id_fk, reg.active_id_fk,
            reg.user_id_fk, reg.status_expen, reg.coupon_number,
            reg.store_id_fk, reg.created_at, reg.updated_at,

            fuel.fuel_id, fuel.liter_value, fuel.coupon_number AS fuel_coupon_number,
            fuel.km_day AS fuel_km_day, fuel.liter_qtd, fuel.fuel_type_id_fk,
            ft.description AS fuel_type_description, fuel.item_number,
            fuel.detail AS fuel_detail,

            maint.maint_id, maint.technician, maint.service_value, maint.list_parts,
            maint.value_parts, maint.km_day AS maint_km_day, maint.km_next,
            maint.date_next, maint.warranty, maint.validity,

            sin.sinister_id, sin.guilty, sin.victim, sin.finished,
            sin.others_documents, sin.data_third, sin.bo_number,
            sin.bo_receipt_date, sin.bo_shipping_date, sin.observation,
            sin.damage_type_id_fk, dt.description AS damage_type_description,
            sin.id_insurance_fk,

            fine.fine_id, fine.infraction AS fine_infraction, fine.ait,
            fine.gravity, fine.points, fine.article_ctb,
            fine.offending_driver_date, fine.offending_driver,
            fine.infraction_id_fk, inf.infraction AS infraction_description,

            ins.id_insurance, ins.risk_cep, ins.adjustment_factor, ins.deductible_type,
            ins.shielding, ins.property_damage, ins.bodily_damages, ins.moral_damages,
            ins.glasses, ins.assist_24hrs, ins.km_trailer, ins.backup_car,
            ins.policy_number, ins.proposal_number, ins.date_init, ins.date_final,
            ins.bodywork, ins.IOF_value AS iof_value, ins.insurance_value,
            ins.deductible_value, ins.form_payment, ins.franchise_list,
            ins.status_insurance, ins.ins_id_fk, ins.cov_id_fk, ins.util_id_fk,
            ins.vehicle_id_fk

        FROM global.gapp_expenses_register reg
        INNER JOIN global.gapp_active act ON reg.active_id_fk = act.active_id
        LEFT JOIN global.gapp_expenses_type expt ON expt.exp_type_id = reg.exp_type_id_fk
        LEFT JOIN global.gapp_fuel fuel ON fuel.expen_id_fk = reg.expen_id
        LEFT JOIN global.gapp_fuel_type ft ON ft.id_fuel_type = fuel.fuel_type_id_fk
        LEFT JOIN global.gapp_maintenance maint ON maint.expen_id_fk = reg.expen_id
        LEFT JOIN global.gapp_sinister sin ON sin.expen_id_fk = reg.expen_id
        LEFT JOIN global.gapp_damage_type dt ON dt.damage_type_id = sin.damage_type_id_fk
        LEFT JOIN global.gapp_fines fine ON fine.expen_id_fk = reg.expen_id
        LEFT JOIN global.gapp_infractions inf ON inf.infraction_id = fine.infraction_id_fk
        LEFT JOIN global.gapp_insurance ins ON ins.expen_id_fk = reg.expen_id
        WHERE reg.expen_id = ? AND act.work_group_fk = ?
    `;
}

module.exports = {
    sqlInsertExpense, buildInsertExpenseParams,
    sqlUpdateExpense, buildUpdateExpenseParams,
    sqlGetActiveWorkGroup, sqlGetVehicleIdByActiveId, sqlGetExpenseType,
    sqlInsertFuel, buildInsertFuelParams,
    sqlUpdateFuel, buildUpdateFuelParams,
    sqlInsertMaintenance, buildInsertMaintenanceParams,
    sqlUpdateMaintenance, buildUpdateMaintenanceParams,
    sqlInsertSinister, buildInsertSinisterParams,
    sqlUpdateSinister, buildUpdateSinisterParams,
    sqlInsertFine, buildInsertFineParams,
    sqlUpdateFine, buildUpdateFineParams,
    sqlLinkInsuranceToExpense, sqlGetInsuranceIdByExpenseId,
    sqlListExpenses, sqlCountExpenses,
    sqlListVehicleExpenses, sqlCountVehicleExpenses,
    sqlGetExpenseById
};
