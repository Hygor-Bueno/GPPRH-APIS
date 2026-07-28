/**
 * @fileoverview Adapter Oracle — implementa `OracleEppRepositoryPort`.
 *
 * Delega 1:1 para `repositories/oracle/epp.oracle.queries.js` (inalterado).
 * Compartilhado entre product/stock/log-sale/order.
 *
 * @module modules/global/infrastructure/epp/oracle-epp.repository
 */

const { OracleEppRepositoryPort } = require('../../application/epp/ports/oracle-epp-repository.port');
const {
    getProductDescriptions,
    getProductConsinco,
    getReceipeByProduct,
    getReceipeByProducts,
    getRawMaterialQtyFromMenus,
    getEcommerceOrder,
} = require('../../repositories/oracle/epp.oracle.queries');

class OracleEppRepository extends OracleEppRepositoryPort {
    async getProductDescriptions(seqProdutos) {
        return getProductDescriptions(seqProdutos);
    }

    async getProductConsinco(codigoAcesso, lojas) {
        return getProductConsinco(codigoAcesso, lojas);
    }

    async getReceipeByProduct(seqProduto) {
        return getReceipeByProduct(seqProduto);
    }

    async getReceipeByProducts(seqProdutos) {
        return getReceipeByProducts(seqProdutos);
    }

    async getRawMaterialQtyFromMenus(seqRawMaterial, menuProductIds) {
        return getRawMaterialQtyFromMenus(seqRawMaterial, menuProductIds);
    }

    async getEcommerceOrder(nroPedido) {
        return getEcommerceOrder(nroPedido);
    }
}

module.exports = { OracleEppRepository };
