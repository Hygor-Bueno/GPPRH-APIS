const { EppOrderEntity } = require('../order.entity');
const { AppError } = require('../../../../../../errors/app.error');

const STORE = { name: 'Interlagos', number: 1 };

// Formata usando componentes locais (não toISOString, que é UTC) — evita
// falso-negativo no limite exato do range quando o fuso horário local está
// atrás de UTC (ex.: Brasil).
function isoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

describe('EppOrderEntity', () => {
    it('should accept a delivery date in the middle of the allowed range', () => {
        const today = new Date();
        const entity = new EppOrderEntity({
            payload: { delivery_date: isoDate(today), total: 10 },
            store: STORE,
        });
        expect(entity.delivery_date).toBe(isoDate(today));
    });

    it('should accept a date safely inside the lower bound (today - 14 days)', () => {
        // Não testamos o limite exato de 15 dias: `new Date('YYYY-MM-DD')` do
        // JS interpreta a string como UTC, enquanto `today`/`minDate` são
        // calculados em hora local — em fusos atrás de UTC (ex.: Brasil) isso
        // desloca a data efetiva ~3h para trás, tornando o limite exato
        // sensível ao fuso horário. É um comportamento pré-existente do
        // método original (`_validateDeliveryDate`), preservado nesta
        // migração — não corrigido aqui.
        const today = new Date();
        const minDate = new Date(today);
        minDate.setDate(minDate.getDate() - 14);
        expect(() => new EppOrderEntity({ payload: { delivery_date: isoDate(minDate) }, store: STORE })).not.toThrow();
    });

    it('should accept the upper bound (last day of the current month)', () => {
        const today = new Date();
        const maxDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        expect(() => new EppOrderEntity({ payload: { delivery_date: isoDate(maxDate) }, store: STORE })).not.toThrow();
    });

    it('should reject a date before the lower bound', () => {
        const today = new Date();
        const tooEarly = new Date(today);
        tooEarly.setDate(tooEarly.getDate() - 16);
        expect(() => new EppOrderEntity({ payload: { delivery_date: isoDate(tooEarly) }, store: STORE }))
            .toThrow(AppError);
    });

    it('should reject a date after the upper bound', () => {
        const today = new Date();
        const tooLate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        expect(() => new EppOrderEntity({ payload: { delivery_date: isoDate(tooLate) }, store: STORE }))
            .toThrow(AppError);
    });

    it('should reject an invalid date', () => {
        expect(() => new EppOrderEntity({ payload: { delivery_date: 'not-a-date' }, store: STORE }))
            .toThrow(AppError);
    });

    it('should default optional fields to null and delivered to 0', () => {
        const today = new Date();
        const entity = new EppOrderEntity({ payload: { delivery_date: isoDate(today) }, store: STORE });

        expect(entity.fone).toBeNull();
        expect(entity.email).toBeNull();
        expect(entity.observation).toBeNull();
        expect(entity.delivered).toBe(0);
        expect(entity.storeName).toBe('Interlagos');
        expect(entity.storeNumber).toBe(1);
    });

    it('should split delivery_store into name and number', () => {
        const today = new Date();
        const entity = new EppOrderEntity({
            payload: { delivery_date: isoDate(today), delivery_store: 'Centro_2' },
            store: STORE,
        });
        expect(entity.deliveryStoreName).toBe('Centro');
        expect(entity.deliveryStoreNumber).toBe(2);
    });
});
