/**
 * @fileoverview Controller da grade de produtos do miepp.
 *
 * Inclui a busca de produto (`GET /miepp/product-search`), que reusa o caso de
 * uso do BPPP em vez de duplicar a consulta ao Consinco.
 *
 * ─── Por que a busca não aponta direto para `/bppp/products` ─────────────────
 * A rota do BPPP exige `BPPP_USE`/`BPPP_MANAGE`. Quem monta grade tem
 * `MIEPP_EDIT` e normalmente não tem BPPP — a tela tomaria 403 na primeira
 * busca. As alternativas eram conceder `BPPP_USE` a todos os editores de mídia
 * (amplia permissão de gente que não precisa de busca de preço) ou expor a
 * mesma consulta atrás da permissão que essa gente já tem. É a segunda: o caso
 * de uso é o MESMO objeto, então preço e regra de busca não podem divergir
 * entre os dois módulos.
 *
 * @module modules/global/controllers/miepp-product-grid.controller
 */

const { MieppProductGridUseCases } = require('../application/miepp/product-grid/miepp-product-grid.use-cases');
const { MysqlMieppProductGridRepository } = require('../infrastructure/miepp/mysql-miepp-product-grid.repository');
const { BpppProductUseCases } = require('../application/bppp/product/bppp-product.use-cases');
const { OracleProductRepository } = require('../infrastructure/bppp/oracle-product.repository');
const { mediaStorage } = require('../infrastructure/miepp/miepp-services');
const { AppError } = require('../../../errors/app.error');
const { respond } = require('../../../utils/respond');

const useCases = new MieppProductGridUseCases({
    repository: new MysqlMieppProductGridRepository(),
});

const productUseCases = new BpppProductUseCases({
    oracleRepository: new OracleProductRepository(),
});

async function list(req, res) {
    return respond.ok(res, await useCases.list(req.query));
}

async function getById(req, res) {
    return respond.ok(res, await useCases.getById(Number(req.params.id)));
}

async function create(req, res) {
    return respond.created(res, await useCases.create(req.body, req.user));
}

async function update(req, res) {
    return respond.ok(res, await useCases.update(Number(req.params.id), req.body));
}

/**
 * Sobe a imagem de fundo e a vincula à grade.
 *
 * O binário vai para `_files` ANTES do UPDATE, igual ao cadastro de mídia: se a
 * gravação falhar, a grade continua apontando para o fundo anterior em vez de
 * ficar com um id de arquivo que não existe.
 */
async function uploadBackground(req, res) {
    if (!req.file) {
        throw new AppError('Envie a imagem no campo "file".', 400);
    }

    const stored = await mediaStorage.save(req.file, req.user?.id ?? null);
    return respond.ok(res, await useCases.setBackground(Number(req.params.id), stored));
}

async function requestRender(req, res) {
    return respond.ok(res, await useCases.requestRender(Number(req.params.id)));
}

async function remove(req, res) {
    return respond.ok(res, await useCases.remove(Number(req.params.id)));
}

async function listRenders(req, res) {
    return respond.ok(res, await useCases.listRenders(Number(req.params.id), req.query));
}

/**
 * GET /miepp/product-search
 * Query: `shop_id` + exatamente UM de `plu` | `ean` | `description`.
 *
 * Resposta idêntica à de `GET /bppp/products` — é o mesmo caso de uso. O painel
 * usa isto para escolher o produto; os campos de preço que voltam aqui são
 * conferência do editor, e NÃO devem ser reenviados ao salvar a grade (o
 * `MieppProductGridUseCases` recusa o payload que os traz).
 */
async function searchProducts(req, res) {
    const { shop_id, plu, id, ean, description } = req.query;
    const pluParam = plu ?? id;

    const data = await productUseCases.searchProducts({
        shopId:      Number(shop_id),
        plu:         pluParam != null && pluParam !== '' ? Number(pluParam) : undefined,
        ean,
        description,
    });

    return respond.ok(res, data);
}

module.exports = {
    list,
    getById,
    create,
    update,
    uploadBackground,
    requestRender,
    remove,
    listRenders,
    searchProducts,
};
