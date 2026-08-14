/**
 * @fileoverview Casos de uso — Shop.
 * @module modules/global/application/shop/shop.use-cases
 */

const { AppError } = require('../../../../errors/app.error');
const { groupMysqlByCnpj, buildAuditResults } = require('../../domain/shop/shop-audit.shaper');

const VALID_SOURCES = ['protheus', 'consinco'];

class ShopUseCases {
    /**
     * @param {{
     *   repository: import('./ports/shop-repository.port').ShopRepositoryPort,
     *   externalSources: {
     *     protheus: import('./ports/shop-external-source-repository.port').ShopExternalSourceRepositoryPort,
     *     consinco: import('./ports/shop-external-source-repository.port').ShopExternalSourceRepositoryPort,
     *   },
     * }} deps
     */
    constructor({ repository, externalSources }) {
        this.repository = repository;
        this.externalSources = externalSources;
    }

    async getShops(companyId = null) {
        return this.repository.findAll(companyId);
    }

    /**
     * Lojas com código no Consinco — seletor de loja do BPPP.
     *
     * Separada de `getShops` porque o BPPP consulta preço e estoque no Consinco:
     * oferecer uma loja sem código lá levaria o usuário a uma busca que nunca
     * retorna resultado.
     *
     * @returns {Promise<object[]>}
     */
    async getShopsForBppp() {
        return this.repository.findAllFromConsinco();
    }

    /**
     * Cruza o cadastro de lojas do MySQL com uma fonte externa (Protheus ou Consinco).
     * @param {'protheus'|'consinco'} source
     * @throws {AppError} 400 se a fonte for inválida
     */
    async getAudit(source) {
        if (!VALID_SOURCES.includes(source)) {
            throw new AppError('Parâmetro source inválido. Use: protheus | consinco', 400);
        }

        const externalSource = this.externalSources[source];
        const [mysqlRows, externalRows] = await Promise.all([
            this.repository.findAllWithCodes(),
            externalSource.findAll(),
        ]);

        const mysqlByCnpj = groupMysqlByCnpj(mysqlRows);
        return buildAuditResults(externalRows, mysqlByCnpj, source);
    }
}

module.exports = { ShopUseCases };
