/**
 * @fileoverview Serviço de Produtos EPP.
 *
 * Gerencia CRUD de produtos e categorias do sistema de encomendas.
 * Integra MySQL (tabelas epp_product / epp_category) com Oracle
 * (consulta de produtos/preços no ERP Consinco).
 *
 * @module modules/global/services/epp-product.service
 */

const { poolGlobal }                = require('../../../config/mysql');
const { AppError }                  = require('../../../errors/app.error');
const { getProductConsinco }        = require('../repositories/oracle/epp.oracle.repository');
const {
    SQL_GET_PRODUCTS,
    SQL_GET_PRODUCTS_COMPLETE,
    SQL_GET_PRODUCT_BY_ID,
    SQL_GET_CATEGORIES,
    sqlSearchProducts,
    SQL_INSERT_PRODUCT,
    SQL_UPDATE_PRODUCT,
    SQL_CHANGE_PRODUCT_STATUS,
    SQL_CHECK_PRODUCT_OPEN_ORDERS,
    SQL_DELETE_PRODUCT,
} = require('../repositories/mysql/epp.repository');

class EppProductService {

    // ─── Consultas ────────────────────────────────────────────────────────────

    /** Lista produtos ativos com nome da categoria. */
    async getProducts() {
        const [rows] = await poolGlobal.query(SQL_GET_PRODUCTS);
        return rows;
    }

    /** Lista todos os produtos (ativos + inativos) com nome da categoria. */
    async getProductsComplete() {
        const [rows] = await poolGlobal.query(SQL_GET_PRODUCTS_COMPLETE);
        return rows;
    }

    /**
     * Retorna um produto pelo ID.
     * @throws {AppError} 404 se não encontrado.
     */
    async getProductById(id) {
        const [rows] = await poolGlobal.query(SQL_GET_PRODUCT_BY_ID, [id]);
        if (!rows[0]) throw new AppError('Produto não encontrado', 404);
        return rows[0];
    }

    /** Lista todas as categorias. */
    async getCategories() {
        const [rows] = await poolGlobal.query(SQL_GET_CATEGORIES);
        return rows;
    }

    /**
     * Busca produtos com filtros parametrizados.
     * @param {object} filters - { id_product?, id_category_fk?, status_prod? }
     */
    async searchProducts(filters) {
        const { sql, params } = sqlSearchProducts(filters);
        const [rows] = await poolGlobal.query(sql, params);
        return rows;
    }

    /**
     * Consulta produto(s) no ERP Consinco (Oracle) por código de barras.
     *
     * @param {string}  codigoAcesso - Código de barras do produto
     * @param {string}  lojas        - IDs de loja separados por vírgula (ex: "1,2,3")
     * @returns {Promise<object[]>}
     */
    async getProductConsinco(codigoAcesso, lojas) {
        return getProductConsinco(codigoAcesso, lojas);
    }

    // ─── Criação ──────────────────────────────────────────────────────────────

    /**
     * Cadastra um novo produto.
     * @throws {AppError} 409 se id_product já existir.
     */
    async createProduct({ id_product, description, price, status_prod, id_category_fk, measure }) {
        // Verifica duplicidade
        const [existing] = await poolGlobal.query(
            'SELECT id_product FROM epp_product WHERE id_product = ?', [id_product]
        );
        if (existing[0]) throw new AppError(`Produto ${id_product} já cadastrado`, 409);

        await poolGlobal.query(SQL_INSERT_PRODUCT, [
            id_product, description, price, status_prod, id_category_fk, measure
        ]);
        return this.getProductById(id_product);
    }

    // ─── Atualização ──────────────────────────────────────────────────────────

    /**
     * Bloqueia a inativação de um produto vinculado a pedido em aberto (delivered = 0).
     * @throws {AppError} 409
     */
    async _assertNotLinkedToOpenOrder(id) {
        const [rows] = await poolGlobal.query(SQL_CHECK_PRODUCT_OPEN_ORDERS, [id]);
        if (rows.length) {
            throw new AppError('Produto vinculado a pedido em aberto e não pode ser inativado', 409);
        }
    }

    /**
     * Atualiza completamente um produto.
     * @throws {AppError} 404 se não encontrado, 409 se tentar inativar produto com pedido em aberto.
     */
    async updateProduct(id, { description, price, status_prod, id_category_fk, measure }) {
        if (Number(status_prod) === 0) await this._assertNotLinkedToOpenOrder(id);

        const [result] = await poolGlobal.query(SQL_UPDATE_PRODUCT, [
            description, price, status_prod, id_category_fk, measure, id
        ]);
        if (result.affectedRows === 0) throw new AppError('Produto não encontrado', 404);
        return this.getProductById(id);
    }

    /**
     * Altera apenas o status de um produto (ativo/inativo).
     * @throws {AppError} 404 se não encontrado, 409 se tentar inativar produto com pedido em aberto.
     */
    async changeProductStatus(id, status_prod) {
        if (Number(status_prod) === 0) await this._assertNotLinkedToOpenOrder(id);

        const [result] = await poolGlobal.query(SQL_CHANGE_PRODUCT_STATUS, [status_prod, id]);
        if (result.affectedRows === 0) throw new AppError('Produto não encontrado', 404);
        return { id_product: id, status_prod };
    }

    // ─── Exclusão ─────────────────────────────────────────────────────────────

    /**
     * Remove um produto. Bloqueia se houver itens de pedido vinculados.
     * @throws {AppError} 404 / 409
     */
    async deleteProduct(id) {
        const [existing] = await poolGlobal.query(
            'SELECT id_product FROM epp_product WHERE id_product = ?', [id]
        );
        if (!existing[0]) throw new AppError('Produto não encontrado', 404);

        const [linked] = await poolGlobal.query(
            'SELECT epp_id_log FROM epp_log_sale WHERE epp_id_product = ? LIMIT 1', [id]
        );
        if (linked[0]) throw new AppError('Produto possui pedidos vinculados e não pode ser excluído', 409);

        await poolGlobal.query(SQL_DELETE_PRODUCT, [id]);
        return { deleted: true };
    }
}

module.exports = { EppProductService };
