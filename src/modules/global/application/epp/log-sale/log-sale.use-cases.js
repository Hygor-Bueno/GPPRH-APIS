/**
 * @fileoverview Casos de uso — Log de Vendas EPP.
 *
 * Orquestra a porta MySQL (CRUD/views) e a porta Oracle compartilhada
 * (receitas técnicas e descrições de produto), usando a calculadora de
 * domínio pura para consolidar a visão mobile de produção.
 *
 * @module modules/global/application/epp/log-sale/log-sale.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { normalizeStoreFilters } = require('../../../domain/epp/log-sale/store-filter.normalizer');
const {
    adjustReceipeQuantities,
    consolidateRawMaterials,
    buildFinalList,
} = require('../../../domain/epp/log-sale/production-list.calculator');

class EppLogSaleUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/log-sale-repository.port').LogSaleRepositoryPort} deps.repository
     * @param {import('../ports/oracle-epp-repository.port').OracleEppRepositoryPort} deps.oracleRepository
     */
    constructor({ repository, oracleRepository }) {
        this.repository = repository;
        this.oracleRepository = oracleRepository;
    }

    // ─── Consultas ────────────────────────────────────────────────────────────

    async getLogSales() {
        return this.repository.findLogSales();
    }

    async getLogSalesByOrder(orderId) {
        return this.repository.findLogSalesByOrder(orderId);
    }

    async getControllerView(filters = {}) {
        const normalized = normalizeStoreFilters(filters);
        return this.repository.findControllerView(normalized);
    }

    async getOracleReceipe(seqProduto) {
        return this.oracleRepository.getReceipeByProduct(seqProduto);
    }

    // ─── Visão Mobile (produção consolidada) ─────────────────────────────────

    async getMobileView(filters = {}) {
        const normalized = normalizeStoreFilters(filters);
        const hasFilters = Object.keys(normalized).length > 0;

        const pendingRows = hasFilters
            ? await this.repository.findReceipeEppFiltered(normalized)
            : await this.repository.findReceipeEpp();
        if (!pendingRows.length) return [];

        const menuProductIds = pendingRows.filter(r => r.menu == 1).map(r => r.epp_id_product);
        const simpleProductIds = pendingRows.filter(r => r.menu == 0).map(r => r.epp_id_product);

        const receipeMenuRows = menuProductIds.length
            ? await this.oracleRepository.getReceipeByProducts(menuProductIds)
            : [];

        const adjustedReceipes = adjustReceipeQuantities(pendingRows, receipeMenuRows);
        const consolidated = consolidateRawMaterials(adjustedReceipes);

        let descriptionMap = {};
        if (simpleProductIds.length) {
            const descRows = await this.oracleRepository.getProductDescriptions(simpleProductIds);
            descriptionMap = Object.fromEntries(descRows.map(r => [r.SEQPRODUTO, r.PRODUTO]));
        }

        const result = buildFinalList(pendingRows, consolidated, descriptionMap);
        result.sort((a, b) => String(a.description).localeCompare(String(b.description)));
        return result;
    }

    // ─── Criação ──────────────────────────────────────────────────────────────

    async createLogSale({ epp_id_order, epp_id_product, quantity, price, menu = 0 }) {
        const exists = await this.repository.orderExists(epp_id_order);
        if (!exists) throw new AppError('Pedido não encontrado', 404);

        const result = await this.repository.insertLogSale({ epp_id_order, epp_id_product, quantity, price, menu });
        return this.repository.findLogSaleById(result.insertId);
    }

    // ─── Atualização ──────────────────────────────────────────────────────────

    async updateLogSale(id, { epp_id_order, epp_id_product, quantity, price, menu = 0 }) {
        const { updated } = await this.repository.updateLogSale(id, { epp_id_order, epp_id_product, quantity, price, menu });
        if (updated === 0) throw new AppError('Item de venda não encontrado', 404);
        return this.repository.findLogSaleById(id);
    }

    // ─── Exclusão ─────────────────────────────────────────────────────────────

    async deleteLogSaleById(id) {
        const { deleted } = await this.repository.deleteLogSaleById(id);
        if (deleted === 0) throw new AppError('Item de venda não encontrado', 404);
        return { deleted: true };
    }

    async deleteLogSaleByOrder(orderId) {
        const { deleted } = await this.repository.deleteLogSaleByOrder(orderId);
        return { deleted };
    }
}

module.exports = { EppLogSaleUseCases };
