/**
 * @fileoverview Porta (contrato) de leitura de produtos no Oracle/Consinco — BPPP.
 *
 * @module modules/global/application/bppp/product/ports/oracle-product-repository.port
 */

class OracleProductRepositoryPort {
    /** @param {number} shopId @param {number} plu @returns {Promise<object[]>} */
    findByPlu(shopId, plu) { throw new Error('Not implemented'); }

    /** @param {number} shopId @param {string} ean @returns {Promise<object[]>} */
    findByEan(shopId, ean) { throw new Error('Not implemented'); }

    /** @param {number} shopId @param {string} pattern @returns {Promise<object[]>} */
    findByDescription(shopId, pattern) { throw new Error('Not implemented'); }
}

module.exports = { OracleProductRepositoryPort };
