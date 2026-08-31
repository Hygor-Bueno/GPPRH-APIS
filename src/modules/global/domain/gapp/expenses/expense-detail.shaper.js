/**
 * @fileoverview Reformatação pura da linha "achatada" (5-way LEFT JOIN) de
 * uma despesa num objeto com sub-tipo aninhado.
 *
 * @module modules/global/domain/gapp/expenses/expense-detail.shaper
 */

/**
 * Reformata a linha (com todas as tabelas de detalhe em LEFT JOIN) num
 * objeto com os campos genéricos + um sub-objeto aninhado por tipo, usando
 * a chave primária de cada extensão para saber se ela veio preenchida.
 *
 * @param {object} row
 * @returns {object}
 */
function shapeExpenseDetail(row) {
    const fuel = row.fuel_id != null ? {
        fuel_id: row.fuel_id,
        liter_value: row.liter_value,
        coupon_number: row.fuel_coupon_number,
        km_day: row.fuel_km_day,
        liter_qtd: row.liter_qtd,
        fuel_type_id_fk: row.fuel_type_id_fk,
        fuel_type_description: row.fuel_type_description,
        item_number: row.item_number,
        detail: row.fuel_detail
    } : null;

    const maintenance = row.maint_id != null ? {
        maint_id: row.maint_id,
        technician: row.technician,
        service_value: row.service_value,
        list_parts: row.list_parts,
        value_parts: row.value_parts,
        km_day: row.maint_km_day,
        km_next: row.km_next,
        date_next: row.date_next,
        warranty: row.warranty,
        validity: row.validity
    } : null;

    const sinister = row.sinister_id != null ? {
        sinister_id: row.sinister_id,
        guilty: row.guilty,
        victim: row.victim,
        finished: row.finished,
        others_documents: row.others_documents,
        data_third: row.data_third,
        bo_number: row.bo_number,
        bo_receipt_date: row.bo_receipt_date,
        bo_shipping_date: row.bo_shipping_date,
        observation: row.observation,
        damage_type_id_fk: row.damage_type_id_fk,
        damage_type_description: row.damage_type_description,
        id_insurance_fk: row.id_insurance_fk
    } : null;

    const fine = row.fine_id != null ? {
        fine_id: row.fine_id,
        infraction: row.fine_infraction,
        ait: row.ait,
        gravity: row.gravity,
        points: row.points,
        article_ctb: row.article_ctb,
        offending_driver_date: row.offending_driver_date,
        offending_driver_fk: row.offending_driver_fk,
        infraction_id_fk: row.infraction_id_fk,
        infraction_description: row.infraction_description
    } : null;

    const insurance = row.id_insurance != null ? {
        id_insurance: row.id_insurance,
        risk_cep: row.risk_cep,
        adjustment_factor: row.adjustment_factor,
        deductible_type: row.deductible_type,
        shielding: row.shielding,
        property_damage: row.property_damage,
        bodily_damages: row.bodily_damages,
        moral_damages: row.moral_damages,
        glasses: row.glasses,
        assist_24hrs: row.assist_24hrs,
        km_trailer: row.km_trailer,
        backup_car: row.backup_car,
        policy_number: row.policy_number,
        proposal_number: row.proposal_number,
        date_init: row.date_init,
        date_final: row.date_final,
        bodywork: row.bodywork,
        iof_value: row.iof_value,
        insurance_value: row.insurance_value,
        deductible_value: row.deductible_value,
        form_payment: row.form_payment,
        franchise_list: row.franchise_list,
        status_insurance: row.status_insurance,
        ins_id_fk: row.ins_id_fk,
        cov_id_fk: row.cov_id_fk,
        util_id_fk: row.util_id_fk,
        vehicle_id_fk: row.vehicle_id_fk
    } : null;

    return {
        expen_id: row.expen_id,
        date: row.date,
        hour: row.hour,
        local: row.local,
        description: row.description,
        total_value: row.total_value,
        discount: row.discount,
        provider: row.provider,
        exp_type_id_fk: row.exp_type_id_fk,
        description_type: row.description_type,
        driver_id_fk: row.driver_id_fk,
        active_id_fk: row.active_id_fk,
        user_id_fk: row.user_id_fk,
        status_expen: row.status_expen,
        coupon_number: row.coupon_number,
        store_id_fk: row.store_id_fk,
        created_at: row.created_at,
        updated_at: row.updated_at,
        fuel,
        maintenance,
        sinister,
        fine,
        insurance
    };
}

module.exports = { shapeExpenseDetail };
