/**
 * @fileoverview Normalização pura de filtros de loja (ex.: "Interlagos_1" → "Interlagos").
 *
 * @module modules/global/domain/epp/log-sale/store-filter.normalizer
 */

const { splitStore } = require('../../../../../utils/store.util');

/**
 * @param {object} filters
 * @returns {object} Filtros com `store`/`delivery_store` normalizados para o nome puro da loja.
 */
function normalizeStoreFilters(filters) {
    const out = { ...filters };
    if (out.store) out.store = splitStore(out.store).name;
    if (out.delivery_store) out.delivery_store = splitStore(out.delivery_store).name;
    return out;
}

module.exports = { normalizeStoreFilters };
