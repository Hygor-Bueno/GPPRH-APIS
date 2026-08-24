const { adjustReceipeQuantities, consolidateRawMaterials, buildFinalList } = require('../production-list.calculator');

describe('adjustReceipeQuantities', () => {
    it('should multiply QTDUNIDUTILIZADA by the pending quantity of the matching final product', () => {
        const pendingRows = [{ epp_id_product: 10, quantity: '3', menu: 1 }];
        const receipeRows = [{ COD_PROD_FINAL: 10, COD_PROD_MAT_PRIMA: 1, QTDUNIDUTILIZADA: '2' }];

        const result = adjustReceipeQuantities(pendingRows, receipeRows);

        expect(result).toEqual([{ COD_PROD_FINAL: 10, COD_PROD_MAT_PRIMA: 1, QTDUNIDUTILIZADA: 6 }]);
    });

    it('should skip receipe rows with no matching pending product', () => {
        const pendingRows = [{ epp_id_product: 10, quantity: '3', menu: 1 }];
        const receipeRows = [{ COD_PROD_FINAL: 999, COD_PROD_MAT_PRIMA: 1, QTDUNIDUTILIZADA: '2' }];

        expect(adjustReceipeQuantities(pendingRows, receipeRows)).toEqual([]);
    });
});

describe('consolidateRawMaterials', () => {
    it('should sum QTDUNIDUTILIZADA for repeated raw materials', () => {
        const adjusted = [
            { COD_PROD_MAT_PRIMA: 1, QTDUNIDUTILIZADA: 6, DESCRICAO_MAT_PRIMA: 'Arroz' },
            { COD_PROD_MAT_PRIMA: 1, QTDUNIDUTILIZADA: 4, DESCRICAO_MAT_PRIMA: 'Arroz' },
            { COD_PROD_MAT_PRIMA: 2, QTDUNIDUTILIZADA: 5, DESCRICAO_MAT_PRIMA: 'Feijão' },
        ];

        const result = consolidateRawMaterials(adjusted);

        expect(result).toHaveLength(2);
        expect(result.find(r => r.COD_PROD_MAT_PRIMA === 1).QTDUNIDUTILIZADA).toBe(10);
        expect(result.find(r => r.COD_PROD_MAT_PRIMA === 2).QTDUNIDUTILIZADA).toBe(5);
    });
});

describe('buildFinalList', () => {
    it('should add extra quantity to a simple product that also appears as a raw material', () => {
        const pendingRows = [{ epp_id_product: 1, quantity: '5', menu: 0 }];
        const consolidated = [{ COD_PROD_MAT_PRIMA: 1, QTDUNIDUTILIZADA: 3 }];
        const descriptionMap = { 1: 'Arroz' };

        const result = buildFinalList(pendingRows, consolidated, descriptionMap);

        expect(result).toEqual([{ epp_id_product: 1, quantity: 8, menu: 0, description: 'Arroz' }]);
    });

    it('should add raw materials from menus that are not present as simple products', () => {
        const pendingRows = [{ epp_id_product: 1, quantity: '5', menu: 1 }]; // menu==1, not a simple product
        const consolidated = [{ COD_PROD_MAT_PRIMA: 2, QTDUNIDUTILIZADA: 7, DESCRICAO_MAT_PRIMA: 'Feijão' }];

        const result = buildFinalList(pendingRows, consolidated, {});

        expect(result).toEqual([{ epp_id_product: 2, quantity: 7, menu: 0, description: 'Feijão' }]);
    });

    it('should combine simple products and extra menu-derived raw materials in one list', () => {
        const pendingRows = [
            { epp_id_product: 1, quantity: '5', menu: 0 }, // simple product
            { epp_id_product: 10, quantity: '2', menu: 1 }, // menu order
        ];
        const consolidated = [
            { COD_PROD_MAT_PRIMA: 1, QTDUNIDUTILIZADA: 3 }, // extra for product 1 (already simple)
            { COD_PROD_MAT_PRIMA: 2, QTDUNIDUTILIZADA: 4, DESCRICAO_MAT_PRIMA: 'Feijão' }, // new raw material
        ];
        const descriptionMap = { 1: 'Arroz' };

        const result = buildFinalList(pendingRows, consolidated, descriptionMap);

        expect(result).toEqual([
            { epp_id_product: 1, quantity: 8, menu: 0, description: 'Arroz' },
            { epp_id_product: 2, quantity: 4, menu: 0, description: 'Feijão' },
        ]);
    });
});
