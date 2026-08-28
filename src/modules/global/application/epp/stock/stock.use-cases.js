/**
 * @fileoverview Casos de uso — Estoque EPP.
 *
 * Orquestra a porta MySQL (CRUD/histórico/paginação) e a porta Oracle
 * compartilhada (cálculo de matéria-prima derivada de menus pendentes).
 *
 * Nota de correção confirmada com o usuário: `findMenusForStock()` é buscada
 * UMA VEZ por chamada de `getStock`, não por linha (o dado não depende do
 * produto da linha) — no service antigo essa busca era redundante,
 * repetida a cada linha do estoque.
 *
 * @module modules/global/application/epp/stock/stock.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

const ITEMS_PER_PAGE = 20;

class EppStockUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/stock-repository.port').StockRepositoryPort} deps.repository
     * @param {import('../ports/oracle-epp-repository.port').OracleEppRepositoryPort} deps.oracleRepository
     */
    constructor({ repository, oracleRepository }) {
        this.repository = repository;
        this.oracleRepository = oracleRepository;
    }

    // ─── Consultas ────────────────────────────────────────────────────────────

    async getStock(idProduct = null) {
        const rows = idProduct
            ? await this.repository.findStockByProduct(idProduct)
            : await this.repository.findStock();

        const menuRows = await this.repository.findMenusForStock();

        const enriched = await Promise.allSettled(
            rows.map(async row => {
                try {
                    const menuQty = await this._getMenuQuantityForProduct(row.id_product_fk, menuRows);
                    return {
                        ...row,
                        stock_quantity: parseFloat(row.stock_quantity) + menuQty,
                        input_quantity: parseFloat(row.input_quantity),
                        output_quantity: parseFloat(row.output_quantity),
                        quantity: parseFloat(row.quantity),
                        percent: row.input_quantity
                            ? Math.round((parseFloat(row.input_quantity) / parseFloat(row.input_quantity)) * 100 * 100) / 100
                            : null,
                    };
                } catch {
                    // Se Oracle falhar, retorna sem o enriquecimento
                    return { ...row };
                }
            })
        );

        return enriched.map(r => r.status === 'fulfilled' ? r.value : r.reason);
    }

    async getStockHistory(idProduct) {
        return this.repository.findStockHistory(idProduct);
    }

    async getPendingProduction(page = 1) {
        const total = await this.repository.countPendingProduction();
        const totalPages = total <= ITEMS_PER_PAGE ? 1 : Math.ceil(total / ITEMS_PER_PAGE);

        const currentPage = Math.max(1, parseInt(page, 10));
        const offset = (currentPage - 1) * ITEMS_PER_PAGE;

        const rows = await this.repository.findPendingProduction(offset, ITEMS_PER_PAGE);
        return { data: rows, pages: totalPages, page: currentPage, total };
    }

    // ─── Criação ──────────────────────────────────────────────────────────────

    async createStock({ id_product_fk, stock_quantity, created_by, updated_by, measure }) {
        if (String(measure).toLowerCase() === 'un' && !Number.isInteger(Number(stock_quantity))) {
            throw new AppError('Quantidade inválida: produto vendido em unidades deve ser inteiro', 400);
        }

        if (parseFloat(stock_quantity) < 0) {
            const currentStock = await this._getCurrentStockQty(id_product_fk);
            if (currentStock < Math.abs(parseFloat(stock_quantity))) {
                throw new AppError('Saída maior que o estoque atual', 400);
            }
        }

        const result = await this.repository.insertStock({ id_product_fk, stock_quantity, created_by, updated_by });
        return this.repository.findStockRawById(result.insertId);
    }

    // ─── Atualização ──────────────────────────────────────────────────────────

    async updateStock(idStock, fields) {
        const exists = await this.repository.stockExists(idStock);
        if (!exists) throw new AppError('Registro de estoque não encontrado', 404);

        if (fields.measure && String(fields.measure).toLowerCase() === 'un'
            && fields.stock_quantity !== undefined
            && !Number.isInteger(Number(fields.stock_quantity))) {
            throw new AppError('Quantidade inválida: produto vendido em unidades deve ser inteiro', 400);
        }

        if (fields.stock_quantity !== undefined && parseFloat(fields.stock_quantity) < 0) {
            const current = await this._getCurrentStockQtyByIdStock(idStock);
            if (current < Math.abs(parseFloat(fields.stock_quantity))) {
                throw new AppError('Saída maior que o estoque atual', 400);
            }
        }

        await this.repository.updateStock(idStock, fields);
        return this.repository.findStockRawById(idStock);
    }

    // ─── Helpers privados ────────────────────────────────────────────────────

    async _getCurrentStockQty(idProduct) {
        const rows = await this.repository.findStockByProduct(idProduct);
        if (!rows[0]) return 0;
        return parseFloat(rows[0].stock_quantity) || 0;
    }

    async _getCurrentStockQtyByIdStock(idStock) {
        const rows = await this.repository.findStockByIdStock(idStock);
        if (!rows[0]) return 0;
        return parseFloat(rows[0].stock_quantity) || 0;
    }

    async _getMenuQuantityForProduct(idProduct, menuRows) {
        if (!menuRows.length) return 0;

        const menuProductIds = menuRows.map(r => r.epp_id_product);
        const receipeRows = await this.oracleRepository.getRawMaterialQtyFromMenus(idProduct, menuProductIds);

        let total = 0;
        for (const receipe of receipeRows) {
            const menu = menuRows.find(m => m.epp_id_product == receipe.COD_PROD_FINAL);
            if (menu) {
                total += parseFloat(receipe.QTDUNIDUTILIZADA) * parseFloat(menu.quantity);
            }
        }
        return total;
    }
}

module.exports = { EppStockUseCases };
