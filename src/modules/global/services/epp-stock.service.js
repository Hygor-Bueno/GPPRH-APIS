/**
 * @fileoverview Serviço de Estoque EPP.
 *
 * Gerencia entradas/saídas de estoque (epp_stock) com:
 * - Validação de quantidade mínima (saída não pode superar estoque atual)
 * - Validação de unidade (produtos 'un' exigem inteiro)
 * - Cálculo de quantidade derivada de menus (Oracle)
 * - Paginação para produtos sem estoque (pending production)
 *
 * @module modules/global/services/epp-stock.service
 */

const { poolGlobal }                  = require('../../../config/mysql');
const { AppError }                    = require('../../../errors/app.error');
const { getRawMaterialQtyFromMenus }  = require('../repositories/oracle/epp.oracle.repository');
const {
    SQL_GET_STOCK,
    SQL_GET_STOCK_BY_PRODUCT,
    SQL_GET_STOCK_BY_ID_STOCK,
    SQL_GET_STOCK_HISTORY,
    SQL_GET_PENDING_PRODUCTION,
    SQL_COUNT_PENDING_PRODUCTION,
    SQL_GET_MENUS_FOR_STOCK,
    SQL_INSERT_STOCK,
    sqlUpdateStock,
} = require('../repositories/mysql/epp.repository');

const ITEMS_PER_PAGE = 20;

class EppStockService {

    // ─── Consultas ────────────────────────────────────────────────────────────

    /**
     * Retorna o estoque atual.
     * Para cada produto, adiciona a quantidade derivada de menus pendentes (Oracle).
     *
     * @param {number|null} idProduct - Filtro opcional por produto
     */
    async getStock(idProduct = null) {
        const [rows] = idProduct
            ? await poolGlobal.query(SQL_GET_STOCK_BY_PRODUCT, [idProduct])
            : await poolGlobal.query(SQL_GET_STOCK);

        // Enriquece com quantidade de menus pendentes via Oracle
        const enriched = await Promise.allSettled(
            rows.map(async row => {
                try {
                    const menuQty = await this._getMenuQuantityForProduct(row.id_product_fk);
                    return {
                        ...row,
                        stock_quantity:   parseFloat(row.stock_quantity) + menuQty,
                        input_quantity:   parseFloat(row.input_quantity),
                        output_quantity:  parseFloat(row.output_quantity),
                        quantity:         parseFloat(row.quantity),
                        percent:          row.input_quantity
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

    /**
     * Retorna o histórico de movimentações de um produto.
     * @param {number} idProduct
     */
    async getStockHistory(idProduct) {
        const [rows] = await poolGlobal.query(SQL_GET_STOCK_HISTORY, [idProduct]);
        return rows;
    }

    /**
     * Lista produtos sem estoque ativo, com paginação.
     * @param {number} page - Página (começa em 1)
     */
    async getPendingProduction(page = 1) {
        const [[countRow]] = await poolGlobal.query(SQL_COUNT_PENDING_PRODUCTION);
        const total      = parseInt(countRow.total, 10);
        const totalPages = total <= ITEMS_PER_PAGE ? 1 : Math.ceil(total / ITEMS_PER_PAGE);

        const currentPage = Math.max(1, parseInt(page, 10));
        const offset      = (currentPage - 1) * ITEMS_PER_PAGE;

        const [rows] = await poolGlobal.query(SQL_GET_PENDING_PRODUCTION, [offset, ITEMS_PER_PAGE]);
        return { data: rows, pages: totalPages, page: currentPage, total };
    }

    // ─── Criação ──────────────────────────────────────────────────────────────

    /**
     * Registra uma entrada ou saída de estoque.
     *
     * @param {{ id_product_fk, stock_quantity, created_by, updated_by, measure }} payload
     * @throws {AppError} 400 se unidade inválida ou saída maior que estoque.
     */
    async createStock({ id_product_fk, stock_quantity, created_by, updated_by, measure }) {
        // Validação: produto 'un' exige inteiro
        if (String(measure).toLowerCase() === 'un' && !Number.isInteger(Number(stock_quantity))) {
            throw new AppError('Quantidade inválida: produto vendido em unidades deve ser inteiro', 400);
        }

        // Validação de saída: não pode ser maior que o estoque atual
        if (parseFloat(stock_quantity) < 0) {
            const currentStock = await this._getCurrentStockQty(id_product_fk);
            if (currentStock < Math.abs(parseFloat(stock_quantity))) {
                throw new AppError('Saída maior que o estoque atual', 400);
            }
        }

        const [result] = await poolGlobal.query(SQL_INSERT_STOCK, [
            id_product_fk, stock_quantity, created_by, updated_by
        ]);
        const [rows] = await poolGlobal.query(
            'SELECT * FROM epp_stock WHERE id_stock = ?', [result.insertId]
        );
        return rows[0];
    }

    // ─── Atualização ──────────────────────────────────────────────────────────

    /**
     * Atualiza um registro de estoque (apenas administradores).
     * Verifica que saída não supere estoque se stock_quantity for negativo.
     *
     * @param {number} idStock     - ID do registro a atualizar
     * @param {object} fields      - Campos a atualizar
     * @param {string} updatedBy   - ID do usuário (deve ser admin — verificado no controller)
     * @throws {AppError} 400 / 404
     */
    async updateStock(idStock, fields) {
        // Verifica existência
        const [existing] = await poolGlobal.query(
            'SELECT id_stock FROM epp_stock WHERE id_stock = ?', [idStock]
        );
        if (!existing[0]) throw new AppError('Registro de estoque não encontrado', 404);

        // Validação de unidade
        if (fields.measure && String(fields.measure).toLowerCase() === 'un'
            && fields.stock_quantity !== undefined
            && !Number.isInteger(Number(fields.stock_quantity))) {
            throw new AppError('Quantidade inválida: produto vendido em unidades deve ser inteiro', 400);
        }

        // Validação de saída
        if (fields.stock_quantity !== undefined && parseFloat(fields.stock_quantity) < 0) {
            const current = await this._getCurrentStockQtyByIdStock(idStock);
            if (current < Math.abs(parseFloat(fields.stock_quantity))) {
                throw new AppError('Saída maior que o estoque atual', 400);
            }
        }

        const { sql, params } = sqlUpdateStock(idStock, fields);
        await poolGlobal.query(sql, params);

        const [rows] = await poolGlobal.query(
            'SELECT * FROM epp_stock WHERE id_stock = ?', [idStock]
        );
        return rows[0];
    }

    // ─── Helpers privados ────────────────────────────────────────────────────

    /**
     * Retorna o estoque líquido atual de um produto (sem enriquecimento Oracle).
     * @private
     */
    async _getCurrentStockQty(idProduct) {
        const [rows] = await poolGlobal.query(SQL_GET_STOCK_BY_PRODUCT, [idProduct]);
        if (!rows[0]) return 0;
        return parseFloat(rows[0].stock_quantity) || 0;
    }

    /**
     * Retorna o estoque do produto ao qual um id_stock pertence.
     * @private
     */
    async _getCurrentStockQtyByIdStock(idStock) {
        const [rows] = await poolGlobal.query(SQL_GET_STOCK_BY_ID_STOCK, [idStock]);
        if (!rows[0]) return 0;
        return parseFloat(rows[0].stock_quantity) || 0;
    }

    /**
     * Calcula a quantidade de matéria-prima de um produto derivada de menus pendentes.
     * Usa Oracle para buscar as receitas técnicas.
     * @private
     */
    async _getMenuQuantityForProduct(idProduct) {
        const [menuRows] = await poolGlobal.query(SQL_GET_MENUS_FOR_STOCK);
        if (!menuRows.length) return 0;

        const menuProductIds = menuRows.map(r => r.epp_id_product);
        const receipeRows    = await getRawMaterialQtyFromMenus(idProduct, menuProductIds);

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

module.exports = { EppStockService };
