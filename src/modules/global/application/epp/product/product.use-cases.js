/**
 * @fileoverview Casos de uso — Produtos EPP.
 *
 * Orquestra a porta MySQL (CRUD) e a porta Oracle compartilhada (consulta
 * Consinco). Os guards de vínculo (pedido em aberto, log de venda) exigem
 * I/O e por isso ficam aqui, não em domínio puro.
 *
 * @module modules/global/application/epp/product/product.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

class EppProductUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/product-repository.port').ProductRepositoryPort} deps.repository
     * @param {import('../ports/oracle-epp-repository.port').OracleEppRepositoryPort} deps.oracleRepository
     */
    constructor({ repository, oracleRepository }) {
        this.repository = repository;
        this.oracleRepository = oracleRepository;
    }

    // ─── Consultas ────────────────────────────────────────────────────────────

    async getProducts() {
        return this.repository.findProducts();
    }

    async getProductsComplete() {
        return this.repository.findProductsComplete();
    }

    async getProductById(id) {
        const product = await this.repository.findProductById(id);
        if (!product) throw new AppError('Produto não encontrado', 404);
        return product;
    }

    async getCategories() {
        return this.repository.findCategories();
    }

    async searchProducts(filters) {
        return this.repository.searchProducts(filters);
    }

    async getProductConsinco(codigoAcesso, lojas) {
        return this.oracleRepository.getProductConsinco(codigoAcesso, lojas);
    }

    // ─── Criação ──────────────────────────────────────────────────────────────

    async createProduct({ id_product, description, price, status_prod, id_category_fk, measure }) {
        const exists = await this.repository.productExists(id_product);
        if (exists) throw new AppError(`Produto ${id_product} já cadastrado`, 409);

        await this.repository.insertProduct({ id_product, description, price, status_prod, id_category_fk, measure });
        return this.getProductById(id_product);
    }

    // ─── Atualização ──────────────────────────────────────────────────────────

    async _assertNotLinkedToOpenOrder(id) {
        const linked = await this.repository.hasOpenOrdersLinked(id);
        if (linked) {
            throw new AppError('Produto vinculado a pedido em aberto e não pode ser inativado', 409);
        }
    }

    async updateProduct(id, { description, price, status_prod, id_category_fk, measure }) {
        if (Number(status_prod) === 0) await this._assertNotLinkedToOpenOrder(id);

        const { updated } = await this.repository.updateProduct(id, { description, price, status_prod, id_category_fk, measure });
        if (updated === 0) throw new AppError('Produto não encontrado', 404);
        return this.getProductById(id);
    }

    async changeProductStatus(id, statusProd) {
        if (Number(statusProd) === 0) await this._assertNotLinkedToOpenOrder(id);

        const { updated } = await this.repository.changeProductStatus(id, statusProd);
        if (updated === 0) throw new AppError('Produto não encontrado', 404);
        return { id_product: id, status_prod: statusProd };
    }

    // ─── Exclusão ─────────────────────────────────────────────────────────────

    async deleteProduct(id) {
        const exists = await this.repository.productExists(id);
        if (!exists) throw new AppError('Produto não encontrado', 404);

        const linked = await this.repository.hasLinkedLogSale(id);
        if (linked) throw new AppError('Produto possui pedidos vinculados e não pode ser excluído', 409);

        await this.repository.deleteProduct(id);
        return { deleted: true };
    }
}

module.exports = { EppProductUseCases };
