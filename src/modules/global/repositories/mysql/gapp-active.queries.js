/**
 * @fileoverview Repositório MySQL para ativos GAPP (gapp_active/gapp_vehicle).
 *
 * Todas as queries usam placeholders (?) para evitar SQL injection —
 * diferente do DAO PHP legado, que montava a CALL via addslashes()/concatenação.
 *
 * @module modules/global/repositories/mysql/gapp-active.queries
 */

function sqlSaveActive() {
    const placeholders = Array(39).fill('?').join(', ');
    return `CALL sp_gapp_save_active_v2(${placeholders}, @p_active_id_out, @p_id_insurance_out)`;
}

function sqlSelectActiveIdOut() {
    return 'SELECT @p_active_id_out AS id, @p_id_insurance_out AS insurance_id';
}

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
        data.is_vehicle ?? null, // mantido por compatibilidade; a procedure decide o tipo pela classificação
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
        vehicle.tank_capacity ?? null,

        // ===== SEGURO (opcional) =====
        // Objeto vazio ({}) conta como "sem seguro" — senão a procedure
        // recebe um JSON não-nulo e tenta gravar todos os campos como NULL.
        isNonEmptyObject(data.insurance) ? JSON.stringify(data.insurance) : null,

        // ===== SMARTPHONE (opcional) =====
        // Mesma regra do seguro: objeto vazio ({}) vira NULL, o que faz a
        // procedure não mexer em gapp_smartphone.
        isNonEmptyObject(data.smartphone) ? JSON.stringify(data.smartphone) : null,

        // ===== SIM (opcional) =====
        // Mesma regra do seguro: objeto vazio ({}) vira NULL, o que faz a
        // procedure não mexer em gapp_sim.
        isNonEmptyObject(data.sim) ? JSON.stringify(data.sim) : null,
    ];
}

function isNonEmptyObject(value) {
    return value != null
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.keys(value).length > 0;
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
    license_plates: 'v.license_plates LIKE ?'
};

// Telefone sem máscara: "(11) 98888-7777" e "11988887777" acham a mesma linha
const digitsOnly = column => `REPLACE(REPLACE(REPLACE(REPLACE(${column}, '(', ''), ')', ''), '-', ''), ' ', '')`;

/*
 * Filtros pelos complementos do ativo (smartphone e chip). Com EXISTS, e não
 * JOIN, o ativo não se repete na lista nem quebra a contagem da paginação.
 * `params` monta os valores de cada `?` da cláusula a partir do que veio na query.
 */
const DEVICE_FILTER_CLAUSES = {
    // IMEI 1 ou 2 do smartphone
    imei: {
        clause: `EXISTS (SELECT 1 FROM global.gapp_smartphone sp
                         WHERE sp.active_id_fk = a.active_id AND (sp.imei_1 LIKE ? OR sp.imei_2 LIKE ?))`,
        params: value => [`%${value}%`, `%${value}%`],
    },
    // Linha: o próprio chip (ativo SIM) ou um dos chips vinculados ao smartphone
    number: {
        clause: `(EXISTS (SELECT 1 FROM global.gapp_sim sm
                          WHERE sm.active_id_fk = a.active_id AND ${digitsOnly('sm.number')} LIKE ?)
              OR EXISTS (SELECT 1 FROM global.gapp_smartphone sp
                          JOIN global.gapp_sim_biding b ON b.sim_biding_id = sp.sim_biding_id_fk
                          JOIN global.gapp_sim sm ON sm.sim_id IN (b.sim_1_id_fk, b.sim_2_id_fk)
                          WHERE sp.active_id_fk = a.active_id AND ${digitsOnly('sm.number')} LIKE ?))`,
        params: value => {
            const digits = `%${String(value).replace(/\D/g, '')}%`;
            return [digits, digits];
        },
    },
    // Nº de série do smartphone ou do chip
    serial_number: {
        clause: `(EXISTS (SELECT 1 FROM global.gapp_smartphone sp WHERE sp.active_id_fk = a.active_id AND sp.serial_number LIKE ?)
              OR EXISTS (SELECT 1 FROM global.gapp_sim sm WHERE sm.active_id_fk = a.active_id AND sm.serial_number LIKE ?))`,
        params: value => [`%${value}%`, `%${value}%`],
    },
};

function buildActiveFilters(filters = {}) {
    const conditions = [];
    const params = [];
    const join = filters.license_plates ? 'JOIN global.gapp_vehicle v ON (a.active_id = v.active_id_fk)' : '';

    for (const [key, clause] of Object.entries(ACTIVE_FILTER_CLAUSES)) {
        if (filters[key] != null && filters[key] !== '') {
            conditions.push(clause);
            params.push(key === 'brand' || key === 'model' || key === 'license_plates' ? `%${filters[key]}%` : filters[key]);
        }
    }

    for (const [key, { clause, params: build }] of Object.entries(DEVICE_FILTER_CLAUSES)) {
        if (filters[key] != null && String(filters[key]).trim() !== '') {
            conditions.push(clause);
            params.push(...build(String(filters[key]).trim()));
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

    return { where: conditions.length ? `${join} WHERE ${conditions.join(' AND ')}` : '', params };
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

function sqlGetSmartphoneById() {
    return 'SELECT * FROM global.gapp_smartphone WHERE active_id_fk = ?'
}


function sqlGetSimById() {
    return 'SELECT * FROM global.gapp_sim WHERE active_id_fk = ?'
}
function sqlGetNumbersyId() {
    return `
    SELECT 
        sim.sim_id,
        sim.*
    FROM global.gapp_sim_biding b_sim
    LEFT JOIN global.gapp_sim sim
        ON sim.sim_id = b_sim.sim_1_id_fk
    WHERE b_sim.sim_biding_id = 382

    UNION ALL

    SELECT 
        sim.sim_id,
        sim.*
    FROM global.gapp_sim_biding b_sim
    LEFT JOIN global.gapp_sim sim
        ON sim.sim_id = b_sim.sim_2_id_fk
    WHERE b_sim.sim_biding_id = ?;`
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
    sqlGetVehicleByActiveId, sqlGetNumbersyId,
    sqlGetIsVehicleByActiveId, sqlGetSmartphoneById, sqlGetSimById
};
