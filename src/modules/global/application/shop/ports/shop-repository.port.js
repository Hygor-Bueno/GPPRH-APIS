/**
 * @fileoverview Porta (contrato) de persistência MySQL — Shop.
 * @module modules/global/application/shop/ports/shop-repository.port
 */

class ShopRepositoryPort {
    /** @param {number|null} companyId @returns {Promise<object[]>} */
    findAll(companyId) { throw new Error('Not implemented'); }

    /** Lojas que possuem código no Consinco — seletor do BPPP. @returns {Promise<object[]>} */
    findAllFromConsinco() { throw new Error('Not implemented'); }

    /** Lojas com todos os códigos de sistema (system_name/code), pra auditoria. @returns {Promise<object[]>} */
    findAllWithCodes() { throw new Error('Not implemented'); }
}

module.exports = { ShopRepositoryPort };
