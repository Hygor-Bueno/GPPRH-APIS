'use strict';

/**
 * @fileoverview Controller BPPP — busca de preço de produto no Consinco.
 * Substitui `GLOBAL/Controller/BPPP/Product.php`.
 *
 * @module modules/global/controllers/bppp-product.controller
 */

const { respond } = require('../../../utils/respond');
const { BpppProductUseCases } = require('../application/bppp/product/bppp-product.use-cases');
const { OracleProductRepository } = require('../infrastructure/bppp/oracle-product.repository');

const useCases = new BpppProductUseCases({
    oracleRepository: new OracleProductRepository(),
});

/**
 * GET /bppp/products
 * Query: shop_id (obrigatório) + UM de: plu | ean | description
 *
 * `id` é aceito como alias de `plu` para compatibilidade com o app legado,
 * que enviava `?id=` na busca por PLU.
 */
async function searchProducts(req, res) {
    const { shop_id, plu, id, ean, description } = req.query;
    const pluParam = plu ?? id;

    const data = await useCases.searchProducts({
        shopId:      Number(shop_id),
        plu:         pluParam != null && pluParam !== '' ? Number(pluParam) : undefined,
        ean,
        description,
    });

    return respond.ok(res, data);
}

/**
 * GET /bppp/departments/:departmentId/products
 * Query: shop_id (obrigatório)
 *
 * Lista os itens de balança ativos de um departamento na loja. Retorna array
 * vazio quando não há item — ausência de produto não é erro aqui.
 */
async function listByDepartment(req, res) {
    const data = await useCases.listByDepartment({
        shopId:       Number(req.query.shop_id),
        departmentId: Number(req.params.departmentId),
    });

    return respond.ok(res, data);
}

module.exports = { searchProducts, listByDepartment };
