/**
 * @fileoverview Casos de uso — BPPP Produto (busca de preço).
 *
 * Migrado de `GLOBAL/Controller/BPPP/Product.php`. Mantém a regra do legado de
 * exigir a loja e exatamente UM critério de busca (plu | ean | description).
 *
 * @module modules/global/application/bppp/product/bppp-product.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { toProductList } = require('../../../domain/bppp/product/product.shaper');

/** Critérios de busca aceitos, na ordem de precedência de resolução. */
const SEARCH_KEYS = ['plu', 'ean', 'description'];

class BpppProductUseCases {
    /**
     * @param {{
     *   oracleRepository: import('./ports/oracle-product-repository.port').OracleProductRepositoryPort
     * }} deps
     */
    constructor({ oracleRepository }) {
        this.oracleRepository = oracleRepository;
    }

    /**
     * Busca produto(s) de uma loja por PLU, EAN ou descrição.
     *
     * @param {{shopId:number, plu?:number, ean?:string, description?:string}} criteria
     * @returns {Promise<object[]>} Lista de produtos (1 item nas buscas por PLU/EAN)
     * @throws {AppError} 400 se a loja faltar ou o número de critérios for != 1
     * @throws {AppError} 404 se nenhum produto for encontrado
     */
    async searchProducts({ shopId, plu, ean, description }) {
        if (!shopId) {
            throw new AppError('Parâmetro obrigatório: shop_id', 400);
        }

        const criteria = { plu, ean, description };
        const informed = SEARCH_KEYS.filter(key => criteria[key] !== undefined
                                                && criteria[key] !== null
                                                && criteria[key] !== '');

        if (informed.length === 0) {
            throw new AppError('Informe um critério de busca: plu, ean ou description', 400);
        }
        if (informed.length > 1) {
            throw new AppError('Informe apenas um critério de busca: plu, ean ou description', 400);
        }

        const rows = await this._findBy(informed[0], shopId, criteria);

        if (!rows.length) {
            throw new AppError('Produto não encontrado', 404);
        }

        return toProductList(rows);
    }

    /**
     * Lista os produtos de um departamento em uma loja.
     *
     * Migrado de `DAOProduct::SelectByShopAndDepartment`, que existia no DAO mas
     * nunca teve rota no PHP — o contrato HTTP é novo. Devolve o mesmo formato
     * de produto das demais buscas do BPPP.
     *
     * Diferente de `searchProducts`, uma lista vazia NÃO é erro: um departamento
     * pode legitimamente não ter item de balança ativo na loja.
     *
     * @param {{shopId:number, departmentId:number}} params
     * @returns {Promise<object[]>}
     * @throws {AppError} 400 se faltar loja ou departamento
     */
    async listByDepartment({ shopId, departmentId }) {
        if (!shopId) {
            throw new AppError('Parâmetro obrigatório: shop_id', 400);
        }
        if (!departmentId) {
            throw new AppError('Parâmetro obrigatório: department_id', 400);
        }

        const rows = await this.oracleRepository.findByShopAndDepartment(shopId, departmentId);
        return toProductList(rows);
    }

    /**
     * Direciona a busca para o repositório conforme o critério informado.
     * @private
     */
    async _findBy(key, shopId, criteria) {
        if (key === 'plu') {
            return this.oracleRepository.findByPlu(shopId, criteria.plu);
        }
        if (key === 'ean') {
            return this.oracleRepository.findByEan(shopId, String(criteria.ean).trim());
        }
        // A descrição no Consinco é gravada em maiúsculas — normaliza e monta o LIKE
        const pattern = `%${String(criteria.description).trim().toUpperCase()}%`;
        return this.oracleRepository.findByDescription(shopId, pattern);
    }
}

module.exports = { BpppProductUseCases };
