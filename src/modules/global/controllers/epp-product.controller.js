/**
 * @fileoverview Controller de Produtos EPP.
 * @module modules/global/controllers/epp-product.controller
 */

const { EppProductService } = require('../services/epp-product.service');
const { respond }           = require('../../../utils/respond');
const { AppError }          = require('../../../errors/app.error');

const service = new EppProductService();

/**
 * GET /epp/products
 * Query: ?complete=1 (todos) | ?category=1 (apenas categorias) |
 *        ?id_product=X | ?id_category_fk=X | ?status_prod=X (busca)
 */
async function getProducts(req, res) {
    const { complete, category, id_product, id_category_fk, status_prod } = req.query;

    if (category) {
        const data = await service.getCategories();
        return respond.ok(res, data);
    }

    if (id_product || id_category_fk || status_prod) {
        const data = await service.searchProducts({ id_product, id_category_fk, status_prod });
        return respond.ok(res, data);
    }

    if (complete) {
        const data = await service.getProductsComplete();
        return respond.ok(res, data);
    }

    const data = await service.getProducts();
    respond.ok(res, data);
}

/**
 * GET /epp/products/consinco
 * Query: codigo_acesso (obrigatório), lojas (obrigatório), full_store? (bool)
 */
async function getProductConsinco(req, res) {
    const { codigo_acesso, lojas, full_store } = req.query;
    if (!codigo_acesso || !lojas) {
        throw new AppError('Parâmetros obrigatórios: codigo_acesso, lojas', 400);
    }
    const lojasParam = full_store ? '1,2,3,7,8,9' : lojas;
    const data = await service.getProductConsinco(codigo_acesso, lojasParam);
    respond.ok(res, data);
}

/**
 * GET /epp/products/:id
 */
async function getProductById(req, res) {
    const data = await service.getProductById(req.params.id);
    respond.ok(res, data);
}

/**
 * POST /epp/products
 * Body: { id_product, description, price, status_prod, id_category_fk, measure }
 */
async function createProduct(req, res) {
    const data = await service.createProduct(req.body);
    respond.created(res, data);
}

/**
 * PUT /epp/products/:id
 * Body: { description, price, status_prod, id_category_fk, measure }
 */
async function updateProduct(req, res) {
    const data = await service.updateProduct(req.params.id, req.body);
    respond.ok(res, data);
}

/**
 * PATCH /epp/products/:id/status
 * Body: { status_prod }
 */
async function changeProductStatus(req, res) {
    const { status_prod } = req.body;
    if (status_prod === undefined) throw new AppError('Campo obrigatório: status_prod', 400);
    const data = await service.changeProductStatus(req.params.id, status_prod);
    respond.ok(res, data);
}

/**
 * DELETE /epp/products/:id
 */
async function deleteProduct(req, res) {
    const data = await service.deleteProduct(req.params.id);
    respond.message(res, 'Produto excluído com sucesso');
}

module.exports = {
    getProducts,
    getProductConsinco,
    getProductById,
    createProduct,
    updateProduct,
    changeProductStatus,
    deleteProduct,
};
