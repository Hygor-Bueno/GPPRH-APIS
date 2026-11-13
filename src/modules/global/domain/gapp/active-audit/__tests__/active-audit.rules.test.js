const {
    AUDIT_STATUS, lockedStatusMessage, normalizeActiveIds, normalizeRegistration,
    findDuplicateIdentifiers, findIdentifierConflicts, buildReview, buildFinalData, buildCanceledData,
} = require('../active-audit.rules');

const INITIAL = {
    assets: [
        { active_id: 120, brand: 'Dell', model: 'Latitude 5440' },
        { active_id: 121, brand: 'Lenovo', model: 'ThinkPad E14' },
        { active_id: 122, brand: 'HP', model: 'ProBook' },
    ],
};

const item = (activeId, overrides = {}) => ({
    active_id_fk: activeId, identifier_type: 'SERIAL', identifier_value: `SN${activeId}`,
    asset_condition: 'GOOD', additional_items: null, observations: null, ...overrides,
});

describe('active-audit.rules', () => {
    test('só ABERTA e EM ANDAMENTO são editáveis', () => {
        expect(lockedStatusMessage(AUDIT_STATUS.OPEN)).toBeNull();
        expect(lockedStatusMessage(AUDIT_STATUS.IN_PROGRESS)).toBeNull();
        expect(lockedStatusMessage(AUDIT_STATUS.FINISHED)).toMatch(/finalizada/);
        expect(lockedStatusMessage(AUDIT_STATUS.CANCELED)).toMatch(/cancelada/);
    });

    describe('normalizeActiveIds', () => {
        test('remove repetidos e converte texto', () => {
            expect(normalizeActiveIds([1, '2', 1])).toEqual({ ids: [1, 2] });
        });
        test.each([[undefined], [[]], [[0]], [['abc']], [[1.5]]])('recusa %p', input => {
            expect(normalizeActiveIds(input).error).toBeDefined();
        });
    });

    describe('normalizeRegistration', () => {
        test('SERIAL exige valor e tira espaços', () => {
            expect(normalizeRegistration({ identifier_type: 'SERIAL', identifier_value: '  ', asset_condition: 'GOOD' }).error).toMatch(/série/);
            expect(normalizeRegistration({ identifier_type: 'SERIAL', identifier_value: ' SN1 ', asset_condition: 'GOOD' }).value.identifier_value).toBe('SN1');
        });
        test('SEM_IDENTIFICACAO descarta o valor', () => {
            const { value } = normalizeRegistration({ identifier_type: 'SEM_IDENTIFICACAO', identifier_value: 'x', asset_condition: 'BAD' });
            expect(value.identifier_value).toBeNull();
        });
        test('recusa tipo e conservação fora da lista', () => {
            expect(normalizeRegistration({ identifier_type: 'IMEI', identifier_value: '1', asset_condition: 'GOOD' }).error).toBeDefined();
            expect(normalizeRegistration({ identifier_type: 'SERIAL', identifier_value: '1', asset_condition: 'OTIMO' }).error).toBeDefined();
        });
        test('additional_items precisa ser objeto de valores simples', () => {
            const base = { identifier_type: 'PATRIMONIO', identifier_value: 'P1', asset_condition: 'GOOD' };
            expect(normalizeRegistration({ ...base, additional_items: ['charger'] }).error).toBeDefined();
            expect(normalizeRegistration({ ...base, additional_items: { charger: { a: 1 } } }).error).toBeDefined();
            expect(normalizeRegistration({ ...base, additional_items: { charger: true, case: false } }).value.additional_items)
                .toEqual({ charger: true, case: false });
            expect(normalizeRegistration({ ...base, additional_items: {} }).value.additional_items).toBeNull();
        });
    });

    test('identificador repetido ignora caixa/espaços e SEM_IDENTIFICACAO', () => {
        const dups = findDuplicateIdentifiers([
            item(120, { identifier_value: 'sn1' }),
            item(121, { identifier_value: 'SN1 ' }),
            item(122, { identifier_type: 'SEM_IDENTIFICACAO', identifier_value: null }),
        ]);
        expect(dups).toEqual([{ identifier_type: 'SERIAL', identifier_value: 'sn1', active_ids: [120, 121] }]);
    });

    test('conflito só quando o identificador já foi de OUTRO ativo', () => {
        const history = [
            { audit_id_fk: 3, active_id_fk: 120, identifier_type: 'SERIAL', identifier_value: 'SN120' }, // mesmo ativo: ok
            { audit_id_fk: 4, active_id_fk: 999, identifier_type: 'SERIAL', identifier_value: 'SN121' },
        ];
        expect(findIdentifierConflicts([item(120), item(121)], history)).toEqual([
            { active_id: 121, identifier_type: 'SERIAL', identifier_value: 'SN121', other_assets: [999], audit_ids: [4] },
        ]);
    });

    test('revisão: pendentes, conservação e divergências', () => {
        const review = buildReview(INITIAL, [item(120), item(121, { asset_condition: 'REGULAR' })]);
        expect(review).toMatchObject({
            quantity_expected: 3, quantity_found: 2, quantity_pending: 1,
            pending: [{ active_id: 122, brand: 'HP', model: 'ProBook' }],
            conditions: { GOOD: 1, REGULAR: 1, BAD: 0, UNUSABLE: 0 },
            has_divergence: true,
        });
        expect(review.divergences).toEqual([expect.objectContaining({ type: 'PENDING', active_id: 122 })]);
    });

    test('final_data segue o formato da especificação', () => {
        const final = buildFinalData(15, INITIAL, [item(120, { additional_items: { charger: true }, observations: 'ok' })]);
        expect(final).toMatchObject({ audit_id: 15, quantity_expected: 3, quantity_found: 1 });
        expect(final.items[0]).toMatchObject({
            active_id: 120, identifier_type: 'SERIAL', identifier_value: 'SN120',
            condition: 'GOOD', additional_items: { charger: true }, observations: 'ok',
        });
    });

    describe('transferência', () => {
        const base = { identifier_type: 'PATRIMONIO', identifier_value: 'P1', asset_condition: 'GOOD' };

        test('exige motivo e guarda o destino do Protheus', () => {
            expect(normalizeRegistration({ ...base, is_transfer: 1, transfer_reason: '  ' }).error).toMatch(/motivo/);
            const { value } = normalizeRegistration({
                ...base, is_transfer: 1, transfer_reason: ' Mudou de loja ',
                transfer_branch_code: '0101', transfer_responsible_registration: ' 000123 ',
            });
            expect(value).toEqual(expect.objectContaining({
                is_transfer: 1, transfer_reason: 'Mudou de loja', transfer_branch_code: '0101',
                transfer_responsible_registration: '000123', transfer_costcenter_code: null,
            }));
            // nomes não são mais gravados
            expect(value).not.toHaveProperty('transfer_branch_name');
        });

        test('sem transferência, motivo e destino ficam nulos', () => {
            const { value } = normalizeRegistration({ ...base, is_transfer: 0, transfer_reason: 'x', transfer_branch_code: '0101' });
            expect(value).toMatchObject({ is_transfer: 0, transfer_reason: null, transfer_branch_code: null });
        });

        test('final_data traz origem × destino e conta como divergência', () => {
            const initial = { assets: [{ active_id: 120, units_id_fk: 3, unit_name: 'Matriz' }] };
            const final = buildFinalData(1, initial, [item(120, {
                is_transfer: 1, transfer_reason: 'Mudou', transfer_branch_code: '0101',
                transfer_costcenter_code: '1001', transfer_responsible_registration: '000123',
            })]);
            expect(final.quantity_transferred).toBe(1);
            expect(final.items[0].transfer).toEqual({
                reason: 'Mudou',
                origin: { unit_id: 3, unit_name: 'Matriz' },
                destination: { branch_code: '0101', costcenter_code: '1001' },
                responsible_registration: '000123',
            });
            expect(final.divergences).toContainEqual(expect.objectContaining({ type: 'TRANSFERRED', active_id: 120 }));
        });

        test('conferência antiga (sem colunas de transferência) segue sem transferência', () => {
            expect(buildFinalData(1, INITIAL, [item(120)]).items[0].transfer).toBeNull();
        });
    });

    test('cancelamento guarda motivo e conferências', () => {
        expect(buildCanceledData(1, INITIAL, [item(120)], ' duplicada ')).toMatchObject({
            canceled: true, reason: 'duplicada', quantity_expected: 3, quantity_found: 1,
        });
    });
});
