/**
 * @fileoverview Porta (contrato) de uma fonte externa de lojas (Protheus ou
 * Consinco) — ambas implementam o mesmo contrato, retornando o formato
 * normalizado `{code, description, cnpj}`.
 *
 * @module modules/global/application/shop/ports/shop-external-source-repository.port
 */

class ShopExternalSourceRepositoryPort {
    /** @returns {Promise<Array<{code:string, description:string, cnpj:string}>>} */
    findAll() { throw new Error('Not implemented'); }
}

module.exports = { ShopExternalSourceRepositoryPort };
