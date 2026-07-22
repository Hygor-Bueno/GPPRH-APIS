/**
 * @fileoverview Serviço de Log de Vendas EPP.
 *
 * Gerencia CRUD dos itens de pedido (epp_log_sale) e integrações com Oracle:
 * - Visão controller (itens + dados do pedido)
 * - Receitas técnicas (Consinco)
 * - Visão mobile (agrega receitas para lista de produção)
 *
 * @module modules/global/services/epp-log-sale.service
 */

const { poolGlobal }              = require('../../../config/mysql');
const { AppError }                = require('../../../errors/app.error');
const { splitStore }              = require('../../../utils/store.util');

// Normaliza "Interlagos_1" → "Interlagos" nos filtros store/delivery_store
function normalizeStoreFilters(filters) {
    const out = { ...filters };
    if (out.store)          out.store          = splitStore(out.store).name;
    if (out.delivery_store) out.delivery_store = splitStore(out.delivery_store).name;
    return out;
}

const {
    getReceipeByProduct,
    getReceipeByProducts,
    getProductDescriptions,
} = require('../repositories/oracle/epp.oracle.repository');
const {
    SQL_GET_LOG_SALES_ALL,
    SQL_GET_LOG_SALES_BY_ORDER,
    sqlGetControllerView,
    SQL_GET_RECEIPE_EPP,
    sqlGetReceipeEppFiltered,
    SQL_INSERT_LOG_SALE,
    SQL_UPDATE_LOG_SALE,
    SQL_DELETE_LOG_SALE_BY_ID,
    SQL_DELETE_LOG_SALE_BY_ORDER,
} = require('../repositories/mysql/epp.repository');

class EppLogSaleService {

    // ─── Consultas ────────────────────────────────────────────────────────────

    /** Lista todos os itens de venda. */
    async getLogSales() {
        const [rows] = await poolGlobal.query(SQL_GET_LOG_SALES_ALL);
        return rows;
    }

    /**
     * Lista itens de venda de um pedido específico.
     * @param {number} orderId
     */
    async getLogSalesByOrder(orderId) {
        const [rows] = await poolGlobal.query(SQL_GET_LOG_SALES_BY_ORDER, [orderId]);
        return rows;
    }

    /**
     * Retorna a visão "Controller": itens de venda com dados completos do pedido e produto.
     * Aceita filtros opcionais de data, loja, cliente, etc.
     *
     * @param {object} filters - Ver sqlGetControllerView no repository.
     */
    async getControllerView(filters = {}) {
        const normalized = normalizeStoreFilters(filters);
        const { sql, params } = sqlGetControllerView(normalized);
        const [rows] = await poolGlobal.query(sql, params);
        return rows;
    }

    /**
     * Retorna a receita técnica de um produto do Consinco (Oracle).
     * @param {number} seqProduto - SEQPRODUTO do produto final no Consinco
     */
    async getOracleReceipe(seqProduto) {
        return getReceipeByProduct(seqProduto);
    }

    // ─── Visão Mobile (produção consolidada) ─────────────────────────────────

    /**
     * Retorna a lista consolidada de ingredientes necessários para produção,
     * cruzando pedidos pendentes (MySQL) com receitas técnicas (Oracle).
     *
     * Lógica (replicada do PHP LogSaleMobile):
     * 1. Busca pedidos pendentes agregados por produto
     * 2. Separa produtos "menu" (item composto) dos simples
     * 3. Para produtos de menu: busca receitas no Oracle e multiplica por quantidade pedida
     * 4. Consolida matérias-primas somando quantidades
     * 5. Produtos simples: busca suas quantidades já existentes na receita (se houver)
     * 6. Retorna lista ordenada por descrição
     *
     * @returns {Promise<object[]>}
     */
    async getMobileView(filters = {}) {
        // 1. Pedidos pendentes agregados (com filtros opcionais)
        const normalized = normalizeStoreFilters(filters);
        const hasFilters = Object.keys(normalized).length > 0;
        let pendingRows;
        if (hasFilters) {
            const { sql, params } = sqlGetReceipeEppFiltered(normalized);
            [pendingRows] = await poolGlobal.query(sql, params);
        } else {
            [pendingRows] = await poolGlobal.query(SQL_GET_RECEIPE_EPP);
        }
        if (!pendingRows.length) return [];

        // 2. Separa menus de produtos simples
        const menuProductIds  = pendingRows.filter(r => r.menu == 1).map(r => r.epp_id_product);
        const simpleProductIds = pendingRows.filter(r => r.menu == 0).map(r => r.epp_id_product);

        // 3. Busca receitas dos menus no Oracle
        let receipeMenuRows = [];
        if (menuProductIds.length) {
            receipeMenuRows = await getReceipeByProducts(menuProductIds);
        }

        // 4. Ajusta quantidades das receitas × quantidade pedida (qualityAdjust do PHP)
        const adjustedReceipes = this._adjustReceipeQuantities(pendingRows, receipeMenuRows);

        // 5. Consolida matérias-primas
        const consolidated = this._consolidateRawMaterials(adjustedReceipes);

        // 6. Busca descrições dos produtos simples no Oracle
        let descriptionMap = {};
        if (simpleProductIds.length) {
            const descRows = await getProductDescriptions(simpleProductIds);
            descriptionMap = Object.fromEntries(
                descRows.map(r => [r.SEQPRODUTO, r.PRODUTO])
            );
        }

        // 7. Constrói a lista final
        const result = this._buildFinalList(pendingRows, consolidated, descriptionMap);

        // 8. Ordena por descrição
        result.sort((a, b) => String(a.description).localeCompare(String(b.description)));
        return result;
    }

    // ─── Helpers privados (lógica Mobile) ────────────────────────────────────

    /**
     * Para cada item de receita, multiplica QTDUNIDUTILIZADA pela
     * quantidade pedida do produto final correspondente.
     * @private
     */
    _adjustReceipeQuantities(pendingRows, receipeRows) {
        const adjusted = [];
        for (const receipe of receipeRows) {
            const pending = pendingRows.find(r => r.epp_id_product == receipe.COD_PROD_FINAL);
            if (pending) {
                adjusted.push({
                    ...receipe,
                    QTDUNIDUTILIZADA: parseFloat(receipe.QTDUNIDUTILIZADA) * parseFloat(pending.quantity)
                });
            }
        }
        return adjusted;
    }

    /**
     * Consolida matérias-primas somando QTDUNIDUTILIZADA para o mesmo COD_PROD_MAT_PRIMA.
     * @private
     */
    _consolidateRawMaterials(adjustedRows) {
        const map = new Map();
        for (const row of adjustedRows) {
            const key = row.COD_PROD_MAT_PRIMA;
            if (!map.has(key)) {
                map.set(key, { ...row });
            } else {
                map.get(key).QTDUNIDUTILIZADA += row.QTDUNIDUTILIZADA;
            }
        }
        return Array.from(map.values());
    }

    /**
     * Constrói a lista final de produção:
     * - Produtos simples: usa quantidade do pedido + quantidade extra vinda de receitas de menus
     * - Matérias-primas de menus que não existem como produto simples no pedido: adiciona como novos itens
     * @private
     */
    _buildFinalList(pendingRows, consolidated, descriptionMap) {
        const result = [];

        // Produtos simples (menu == 0)
        for (const item of pendingRows.filter(r => r.menu == 0)) {
            const rawMaterial = consolidated.find(r => r.COD_PROD_MAT_PRIMA == item.epp_id_product);
            const extraQty    = rawMaterial ? parseFloat(rawMaterial.QTDUNIDUTILIZADA) : 0;
            result.push({
                epp_id_product: item.epp_id_product,
                quantity:        parseFloat(item.quantity) + extraQty,
                menu:            0,
                description:     descriptionMap[item.epp_id_product] || null,
            });
        }

        // Matérias-primas de menus não presentes nos produtos simples
        const simpleIds = pendingRows.filter(r => r.menu == 0).map(r => r.epp_id_product);
        for (const rm of consolidated) {
            if (!simpleIds.includes(rm.COD_PROD_MAT_PRIMA)) {
                result.push({
                    epp_id_product: rm.COD_PROD_MAT_PRIMA,
                    quantity:        rm.QTDUNIDUTILIZADA,
                    menu:            0,
                    description:     rm.DESCRICAO_MAT_PRIMA || null,
                });
            }
        }

        return result;
    }

    // ─── Criação ──────────────────────────────────────────────────────────────

    /**
     * Cria um item de log de venda.
     * @throws {AppError} 404 se pedido não existir.
     */
    async createLogSale({ epp_id_order, epp_id_product, quantity, price, menu = 0 }) {
        const [order] = await poolGlobal.query(
            'SELECT id_order FROM epp_orders WHERE id_order = ?', [epp_id_order]
        );
        if (!order[0]) throw new AppError('Pedido não encontrado', 404);

        const [result] = await poolGlobal.query(SQL_INSERT_LOG_SALE, [
            epp_id_order, epp_id_product, quantity, price, menu
        ]);
        const [rows] = await poolGlobal.query(
            'SELECT * FROM epp_log_sale WHERE epp_id_log = ?', [result.insertId]
        );
        return rows[0];
    }

    // ─── Atualização ──────────────────────────────────────────────────────────

    /**
     * Atualiza um item de log de venda.
     * @throws {AppError} 404
     */
    async updateLogSale(id, { epp_id_order, epp_id_product, quantity, price, menu = 0 }) {
        const [result] = await poolGlobal.query(SQL_UPDATE_LOG_SALE, [
            epp_id_order, epp_id_product, quantity, price, menu, id
        ]);
        if (result.affectedRows === 0) throw new AppError('Item de venda não encontrado', 404);
        const [rows] = await poolGlobal.query(
            'SELECT * FROM epp_log_sale WHERE epp_id_log = ?', [id]
        );
        return rows[0];
    }

    // ─── Exclusão ─────────────────────────────────────────────────────────────

    /** Exclui um item por ID. @throws {AppError} 404 */
    async deleteLogSaleById(id) {
        const [result] = await poolGlobal.query(SQL_DELETE_LOG_SALE_BY_ID, [id]);
        if (result.affectedRows === 0) throw new AppError('Item de venda não encontrado', 404);
        return { deleted: true };
    }

    /** Exclui todos os itens de um pedido. */
    async deleteLogSaleByOrder(orderId) {
        const [result] = await poolGlobal.query(SQL_DELETE_LOG_SALE_BY_ORDER, [orderId]);
        return { deleted: result.affectedRows };
    }
}

module.exports = { EppLogSaleService };
