/**
 * @fileoverview Entidade de domínio — Pedido EPP.
 *
 * Valida a data de entrega e normaliza os campos opcionais do pedido no
 * construtor (mesmo padrão de `gpprh/domain/jobs/job.entity.js`). Recebe a
 * loja já resolvida (via I/O feito pelo use-case) — não conhece ordem
 * posicional de parâmetros SQL, isso é mapeamento de infraestrutura.
 *
 * @module modules/global/domain/epp/order/order.entity
 */

const { AppError } = require('../../../../../errors/app.error');
const { splitStore } = require('../../../../../utils/store.util');

class EppOrderEntity {
    /**
     * @param {Object} params
     * @param {object} params.payload - Campos brutos do pedido.
     * @param {{name: string, number: number}} params.store - Loja resolvida (já via I/O).
     */
    constructor({ payload, store }) {
        this.assign(payload, store);
        this.validateDeliveryDate();
    }

    assign(payload, store) {
        this.user_id = payload.user_id;
        this.storeName = store.name;
        this.storeNumber = store.number;
        this.name_client = payload.name_client;
        this.date_order = payload.date_order;
        this.delivery_date = payload.delivery_date;
        this.delivery_hour = payload.delivery_hour;

        const deliveryStore = splitStore(payload.delivery_store);
        this.deliveryStoreName = deliveryStore.name;
        this.deliveryStoreNumber = deliveryStore.number;

        this.total = payload.total;
        this.fone = payload.fone ?? null;
        this.email = payload.email ?? null;
        this.signal_value = payload.signal_value ?? null;
        this.menu = payload.menu ?? null;
        this.id_menu = payload.id_menu ?? null;
        this.plu_menu = payload.plu_menu ?? null;
        this.type_rice = payload.type_rice ?? null;
        this.description = payload.description ?? null;
        this.delivered = payload.delivered ?? 0;
        this.dessert = payload.dessert ?? null;
        this.observation = payload.observation ?? null;
        this.consinco_order_id = payload.consinco_order_id ?? null;
    }

    /**
     * Valida que a data de entrega está entre (hoje − 15 dias) e o último
     * dia do mês corrente.
     * @throws {AppError} 422
     */
    validateDeliveryDate() {
        const date = new Date(this.delivery_date);
        if (isNaN(date.getTime())) {
            throw new AppError('Data de entrega inválida', 422);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const minDate = new Date(today);
        minDate.setDate(minDate.getDate() - 15);

        const maxDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        if (date < minDate || date > maxDate) {
            throw new AppError(
                `Data de entrega fora do range permitido. ` +
                `Permitido: ${minDate.toISOString().slice(0, 10)} a ${maxDate.toISOString().slice(0, 10)}`,
                422
            );
        }
    }
}

module.exports = { EppOrderEntity };
