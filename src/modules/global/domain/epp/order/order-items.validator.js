/**
 * @fileoverview Validação pura dos itens de um pedido (createOrderWithItems).
 *
 * @module modules/global/domain/epp/order/order-items.validator
 */

const { AppError } = require('../../../../../errors/app.error');

/**
 * Valida que `items` é um array não vazio e que cada item tem os campos
 * obrigatórios (`epp_id_product`, `quantity`, `price`).
 *
 * @param {object[]} items
 * @throws {AppError} 400
 */
function validateOrderItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        throw new AppError('O pedido deve conter ao menos um item.', 400);
    }

    for (const [i, item] of items.entries()) {
        if (item.epp_id_product == null) throw new AppError(`Item[${i}]: campo obrigatório "epp_id_product".`, 400);
        if (item.quantity == null) throw new AppError(`Item[${i}]: campo obrigatório "quantity".`, 400);
        if (item.price == null) throw new AppError(`Item[${i}]: campo obrigatório "price".`, 400);
    }
}

module.exports = { validateOrderItems };
