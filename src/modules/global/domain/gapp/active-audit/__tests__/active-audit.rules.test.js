const {
    AUDIT_STATUS, lockedStatusMessage, normalizeActiveIds, normalizeOpenAudit, validateAuditScope,
    validateTransferDestination, isSameLocation, normalizeRegistration,
    findDuplicateIdentifiers, findIdentifierConflicts, buildReview, buildFinalData, buildCanceledData,
    verifyFinalData, itemsFromFinalData,
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
    asset_condition: 'GOOD', lifecycle_status: 'IN_USE', additional_items: null, observations: null, ...overrides,
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

    describe('abertura', () => {
        test('unidade é obrigatória', () => {
            expect(normalizeOpenAudit({ active_ids: [1] }).error).toMatch(/unidade/);
            expect(normalizeOpenAudit({ unit_id_fk: 'x' }).error).toBeDefined();
        });
        test('sem active_ids (ou lista vazia) = todos do escopo; com lista = só os escolhidos', () => {
            expect(normalizeOpenAudit({ unit_id_fk: 3, active_ids: [] }).value).toEqual({
                scope: { unit_id_fk: 3, dep_id_fk: null, id_active_class_fk: null, active_type_id_fk: null },
                active_ids: null,
            });
            expect(normalizeOpenAudit({ unit_id_fk: '3', dep_id_fk: 30, active_ids: [5, '5', 6] }).value).toMatchObject({
                scope: { unit_id_fk: 3, dep_id_fk: 30 }, active_ids: [5, 6],
            });
            expect(normalizeOpenAudit({ unit_id_fk: 3, active_ids: 'abc' }).error).toBeDefined();
        });
        test('vínculos do escopo: setor ∈ unidade, classe ∈ tipo', () => {
            const scope = { unit_id_fk: 3, dep_id_fk: 30, id_active_class_fk: 7, active_type_id_fk: 2 };
            const ok = { unit: {}, department: { unit_id_fk: 3 }, activeClass: { active_type_id_fk: 2 }, activeType: {} };
            expect(validateAuditScope(scope, ok)).toBeNull();
            expect(validateAuditScope(scope, { ...ok, unit: null })).toMatch(/Unidade/);
            expect(validateAuditScope(scope, { ...ok, department: { unit_id_fk: 9 } })).toMatch(/setor/);
            expect(validateAuditScope(scope, { ...ok, activeClass: { active_type_id_fk: 9 } })).toMatch(/classe/);
        });
    });

    describe('normalizeRegistration', () => {
        test('SERIAL exige valor e tira espaços', () => {
            expect(normalizeRegistration({ identifier_type: 'SERIAL', identifier_value: '  ', asset_condition: 'GOOD', lifecycle_status: 'IN_USE' }).error).toMatch(/série/);
            expect(normalizeRegistration({ identifier_type: 'SERIAL', identifier_value: ' SN1 ', asset_condition: 'GOOD', lifecycle_status: 'IN_USE' }).value.identifier_value).toBe('SN1');
        });
        test('SEM_IDENTIFICACAO descarta o valor', () => {
            const { value } = normalizeRegistration({ identifier_type: 'SEM_IDENTIFICACAO', identifier_value: 'x', asset_condition: 'BAD', lifecycle_status: 'IN_STOCK' });
            expect(value.identifier_value).toBeNull();
        });
        test('recusa tipo e conservação fora da lista', () => {
            expect(normalizeRegistration({ identifier_type: 'IMEI', identifier_value: '1', asset_condition: 'GOOD' }).error).toBeDefined();
            expect(normalizeRegistration({ identifier_type: 'SERIAL', identifier_value: '1', asset_condition: 'OTIMO', lifecycle_status: 'IN_USE' }).error).toBeDefined();
        });
        test('ciclo de vida obrigatório e dentro da lista', () => {
            const base = { identifier_type: 'SERIAL', identifier_value: '1', asset_condition: 'GOOD' };
            expect(normalizeRegistration(base).error).toMatch(/lifecycle_status/);
            expect(normalizeRegistration({ ...base, lifecycle_status: 'LOST' }).error).toMatch(/lifecycle_status/);
            expect(normalizeRegistration({ ...base, lifecycle_status: 'DISCARDED' }).value.lifecycle_status).toBe('DISCARDED');
        });
        test('additional_items precisa ser objeto de valores simples', () => {
            const base = { identifier_type: 'PATRIMONIO', identifier_value: 'P1', asset_condition: 'GOOD', lifecycle_status: 'IN_USE' };
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
        const base = { identifier_type: 'PATRIMONIO', identifier_value: 'P1', asset_condition: 'GOOD', lifecycle_status: 'IN_USE' };

        test('exige motivo e unidade de destino; origem nunca vem do body', () => {
            expect(normalizeRegistration({ ...base, is_transfer: 1, transfer_reason: '  ', transfer_unit_id_fk: 4 }).error).toMatch(/motivo/);
            expect(normalizeRegistration({ ...base, is_transfer: 1, transfer_reason: 'x' }).error).toMatch(/unidade de destino/);
            const { value } = normalizeRegistration({
                ...base, is_transfer: 1, transfer_reason: ' Mudou de loja ', transfer_unit_id_fk: '4',
                transfer_origin_unit_id_fk: 999,
            });
            expect(value).toEqual(expect.objectContaining({
                is_transfer: 1, transfer_reason: 'Mudou de loja', transfer_unit_id_fk: 4, transfer_dep_id_fk: null,
                transfer_origin_unit_id_fk: null, transfer_origin_dep_id_fk: null,
            }));
            expect(value).not.toHaveProperty('transfer_branch_code');
        });

        test('sem transferência, motivo, origem e destino ficam nulos', () => {
            const { value } = normalizeRegistration({ ...base, is_transfer: 0, transfer_reason: 'x', transfer_unit_id_fk: 4 });
            expect(value).toMatchObject({ is_transfer: 0, transfer_reason: null, transfer_unit_id_fk: null, transfer_origin_unit_id_fk: null });
        });

        test('destino: unidade existe e setor é dela; igualdade de local considera setor nulo', () => {
            const value = { is_transfer: 1, transfer_unit_id_fk: 4, transfer_dep_id_fk: 40 };
            expect(validateTransferDestination(value, { unit: {}, department: { unit_id_fk: 4 } })).toBeNull();
            expect(validateTransferDestination(value, { unit: null })).toMatch(/Unidade/);
            expect(validateTransferDestination(value, { unit: {}, department: { unit_id_fk: 5 } })).toMatch(/setor/);
            expect(isSameLocation(4, null, 4, null)).toBe(true);
            expect(isSameLocation(4, null, 4, 40)).toBe(false);
            expect(isSameLocation(4, 40, '4', '40')).toBe(true);
        });

        test('final_data traz origem × destino GAPP com nomes e conta como divergência', () => {
            const final = buildFinalData(1, INITIAL, [item(120, {
                is_transfer: 1, transfer_reason: 'Mudou',
                transfer_origin_unit_id_fk: 3, transfer_origin_unit_name: 'Matriz', transfer_origin_dep_id_fk: 30, transfer_origin_dep_name: 'TI',
                transfer_unit_id_fk: 4, transfer_unit_name: 'Filial', transfer_dep_id_fk: null, transfer_dep_name: null,
            })]);
            expect(final.quantity_transferred).toBe(1);
            expect(final.items[0].transfer).toEqual({
                reason: 'Mudou',
                origin: { unit_id: 3, unit_name: 'Matriz', dep_id: 30, dep_name: 'TI' },
                destination: { unit_id: 4, unit_name: 'Filial', dep_id: null, dep_name: null },
            });
            expect(final.divergences).toContainEqual(expect.objectContaining({ type: 'TRANSFERRED', active_id: 120 }));
        });

        test('conferência sem transferência segue com transfer = null', () => {
            expect(buildFinalData(1, INITIAL, [item(120)]).items[0].transfer).toBeNull();
        });
    });

    test('revisão conta o ciclo de vida', () => {
        const review = buildReview(INITIAL, [item(120), item(121, { lifecycle_status: 'IN_MAINTENANCE' })]);
        expect(review.lifecycles).toEqual({ IN_USE: 1, IN_STOCK: 0, IN_MAINTENANCE: 1, DISCARDED: 0 });
    });

    describe('limpeza da temporária', () => {
        const items = [
            item(120, { user_register_id_fk: 10, user_register_name: 'Ana' }),
            item(121, { is_transfer: 1, transfer_reason: 'x', transfer_unit_id_fk: 4, transfer_dep_id_fk: 40 }),
        ];
        const roundTrip = value => JSON.parse(JSON.stringify(value));

        test('final_data relido igual às conferências → sem problemas', () => {
            expect(verifyFinalData(roundTrip(buildFinalData(1, INITIAL, items)), items)).toEqual([]);
            expect(verifyFinalData(roundTrip(buildCanceledData(1, INITIAL, items, 'x')), items)).toEqual([]);
        });

        test('qualquer diferença bloqueia', () => {
            const saved = roundTrip(buildFinalData(1, INITIAL, items));
            expect(verifyFinalData(null, items)).toHaveLength(1);
            expect(verifyFinalData({ ...saved, items: saved.items.slice(1) }, items)[0]).toMatch(/1 conferência/);
            saved.items[1].transfer.destination.dep_id = 41;
            saved.items[0].lifecycle_status = 'DISCARDED';
            expect(verifyFinalData(saved, items)).toEqual([
                expect.stringMatching(/120: 'lifecycle_status'/),
                expect.stringMatching(/121: 'transfer_dep_id_fk'/),
            ]);
        });

        test('itemsFromFinalData devolve as linhas no formato da temporária', () => {
            const rows = itemsFromFinalData(1, roundTrip(buildFinalData(1, INITIAL, items)));
            expect(rows[0]).toMatchObject({
                audit_temp_id: null, audit_id_fk: 1, active_id_fk: 120, user_register_name: 'Ana',
                asset_condition: 'GOOD', lifecycle_status: 'IN_USE', is_transfer: 0, legacy_transfer: null,
            });
            expect(rows[1]).toMatchObject({ is_transfer: 1, transfer_unit_id_fk: 4, transfer_dep_id_fk: 40 });
        });

        test('final_data antigo (destino Protheus) vira legacy_transfer', () => {
            const [row] = itemsFromFinalData(1, { items: [{
                active_id: 5, identifier_type: 'SEM_IDENTIFICACAO', condition: 'GOOD',
                transfer: { reason: 'r', origin: { unit_id: 3, unit_name: 'M' }, destination: { branch_code: '0101', costcenter_code: '1' }, responsible_registration: '000123' },
            }] });
            expect(row).toMatchObject({
                is_transfer: 1, transfer_origin_unit_id_fk: 3, transfer_unit_id_fk: null, lifecycle_status: null,
                legacy_transfer: { branch_code: '0101', costcenter_code: '1', responsible_registration: '000123' },
            });
        });
    });

    test('cancelamento guarda motivo e conferências', () => {
        expect(buildCanceledData(1, INITIAL, [item(120)], ' duplicada ')).toMatchObject({
            canceled: true, reason: 'duplicada', quantity_expected: 3, quantity_found: 1,
        });
    });
});
