/**
 * @fileoverview Porta (contrato) de acesso ao Oracle/Consinco para a suite EPP.
 *
 * Compartilhada entre os use-cases de produto, estoque, log-sale e pedido —
 * todos consomem o mesmo conjunto de consultas Oracle/Consinco.
 *
 * @module modules/global/application/epp/ports/oracle-epp-repository.port
 */

class OracleEppRepositoryPort {
    /** @param {number[]} seqProdutos @returns {Promise<object[]>} */
    getProductDescriptions(seqProdutos) { throw new Error('Not implemented'); }

    /**
     * @param {string} codigoAcesso
     * @param {string} lojas
     * @returns {Promise<object[]>}
     */
    getProductConsinco(codigoAcesso, lojas) { throw new Error('Not implemented'); }

    /** @param {number} seqProduto @returns {Promise<object[]>} */
    getReceipeByProduct(seqProduto) { throw new Error('Not implemented'); }

    /** @param {number[]} seqProdutos @returns {Promise<object[]>} */
    getReceipeByProducts(seqProdutos) { throw new Error('Not implemented'); }

    /**
     * @param {number} seqRawMaterial
     * @param {number[]} menuProductIds
     * @returns {Promise<object[]>}
     */
    getRawMaterialQtyFromMenus(seqRawMaterial, menuProductIds) { throw new Error('Not implemented'); }

    /** @param {number} nroPedido @returns {Promise<object[]>} */
    getEcommerceOrder(nroPedido) { throw new Error('Not implemented'); }
}

module.exports = { OracleEppRepositoryPort };
