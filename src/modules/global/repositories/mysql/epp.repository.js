/**
 * @fileoverview Repositório MySQL para o módulo EPP.
 *
 * Todas as queries usam placeholders (?) para evitar SQL injection.
 * Nenhum valor de entrada é interpolado diretamente no SQL.
 *
 * Tabelas: epp_product, epp_category, epp_menu, epp_orders,
 *          epp_log_sale, epp_log_menus, epp_stock
 *
 * @module modules/global/repositories/mysql/epp.repository
 */

// ─── Produtos ─────────────────────────────────────────────────────────────────

const SQL_GET_PRODUCTS = `
    SELECT
        a.id_product,
        a.description,
        a.price,
        a.status_prod,
        b.cat_description AS category,
        b.id_category,
        a.measure,
        a.id_category_fk
    FROM epp_product AS a
    INNER JOIN epp_category AS b ON a.id_category_fk = b.id_category
    WHERE a.status_prod = 1
    ORDER BY a.description
`;

const SQL_GET_PRODUCTS_COMPLETE = `
    SELECT
        a.id_product,
        a.description,
        a.price,
        a.status_prod,
        b.cat_description AS category,
        b.id_category,
        a.measure,
        a.id_category_fk
    FROM epp_product AS a
    INNER JOIN epp_category AS b ON a.id_category_fk = b.id_category
    ORDER BY a.description
`;

const SQL_GET_PRODUCT_BY_ID = `
    SELECT
        a.id_product,
        a.description,
        a.price,
        a.status_prod,
        b.cat_description AS category,
        b.id_category,
        a.measure,
        a.id_category_fk
    FROM epp_product AS a
    INNER JOIN epp_category AS b ON a.id_category_fk = b.id_category
    WHERE a.id_product = ?
`;

const SQL_GET_CATEGORIES = `SELECT id_category, cat_description FROM epp_category ORDER BY cat_description`;

/**
 * Constrói query de busca parametrizada para produtos.
 * Aceita filtros opcionais: id_product, id_category_fk, status_prod.
 *
 * @param {object} filters
 * @returns {{ sql: string, params: any[] }}
 */
function sqlSearchProducts(filters = {}) {
    const conditions = [];
    const params     = [];

    if (filters.id_product != null) {
        conditions.push('a.id_product = ?');
        params.push(filters.id_product);
    }
    if (filters.id_category_fk != null) {
        conditions.push('a.id_category_fk = ?');
        params.push(filters.id_category_fk);
    }
    if (filters.status_prod != null) {
        conditions.push('a.status_prod = ?');
        params.push(filters.status_prod);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return {
        sql: `
            SELECT a.id_product, a.description, a.price, a.status_prod,
                   b.cat_description AS category, a.measure, a.id_category_fk
            FROM epp_product AS a
            LEFT JOIN epp_category AS b ON a.id_category_fk = b.id_category
            ${where}
            ORDER BY a.description
        `,
        params
    };
}

const SQL_INSERT_PRODUCT = `
    INSERT INTO epp_product (id_product, description, price, status_prod, id_category_fk, measure)
    VALUES (?, ?, ?, ?, ?, ?)
`;

const SQL_UPDATE_PRODUCT = `
    UPDATE epp_product
    SET description = ?, price = ?, status_prod = ?, id_category_fk = ?, measure = ?
    WHERE id_product = ?
`;

const SQL_CHANGE_PRODUCT_STATUS = `
    UPDATE epp_product SET status_prod = ? WHERE id_product = ?
`;

const SQL_DELETE_PRODUCT = `DELETE FROM epp_product WHERE id_product = ?`;

/** Pedidos em aberto (delivered = 0) que contêm o produto — usada para bloquear inativação. */
const SQL_CHECK_PRODUCT_OPEN_ORDERS = `
    SELECT
        od.*
    FROM
        global.epp_orders od
            INNER JOIN
        global.epp_log_sale sa ON od.id_order = sa.epp_id_order
    WHERE
        sa.epp_id_product = ?
            AND od.delivered = 0
`;

// ─── Menus ────────────────────────────────────────────────────────────────────

const SQL_GET_MENUS_ACTIVE = `
    SELECT id_menu, description, status FROM epp_menu WHERE status = 1 ORDER BY description
`;

const SQL_GET_MENUS_ALL = `
    SELECT id_menu, description, status FROM epp_menu ORDER BY description
`;

/**
 * Constrói query de busca parametrizada para menus.
 * @param {object} filters - { id_menu?, status?, description? }
 * @returns {{ sql: string, params: any[] }}
 */
function sqlSearchMenus(filters = {}) {
    const conditions = [];
    const params     = [];

    if (filters.id_menu != null) {
        conditions.push('id_menu = ?');
        params.push(filters.id_menu);
    }
    if (filters.status != null) {
        conditions.push('status = ?');
        params.push(filters.status);
    }
    if (filters.description != null) {
        conditions.push('description LIKE ?');
        params.push(`%${filters.description}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return {
        sql: `SELECT id_menu, description, status FROM epp_menu ${where} ORDER BY description`,
        params
    };
}

const SQL_INSERT_MENU = `INSERT INTO epp_menu (description, status) VALUES (?, ?)`;

const SQL_UPDATE_MENU = `
    UPDATE epp_menu SET description = ?, status = ? WHERE id_menu = ?
`;

const SQL_DELETE_MENU = `DELETE FROM epp_menu WHERE id_menu = ?`;

// ─── Log Menus (configuração de produtos por menu) ────────────────────────────

const SQL_GET_LOG_MENUS = `
    SELECT
        e.epp_log_id,
        e.plu_menu,
        e.status_log_menu,
        e.type_base,
        e.epp_id_menu,
        e.epp_id_product,
        m.id_menu,
        m.description AS description_menu,
        m.status      AS status_menu,
        p.id_product,
        p.description AS description_product,
        p.price,
        p.status_prod,
        p.id_category_fk AS category,
        p.measure
    FROM epp_log_menus AS e
    INNER JOIN epp_menu    AS m ON e.epp_id_menu    = m.id_menu
    INNER JOIN epp_product AS p ON e.epp_id_product = p.id_product
    ORDER BY m.id_menu, e.plu_menu
`;

const SQL_GET_LOG_MENUS_BY_PLU = `
    SELECT
        e.epp_log_id,
        e.plu_menu,
        e.status_log_menu,
        e.type_base,
        e.epp_id_menu,
        e.epp_id_product,
        m.id_menu,
        m.description AS description_menu,
        m.status      AS status_menu,
        p.id_product,
        p.description AS description_product,
        p.price,
        p.status_prod,
        p.id_category_fk AS category,
        p.measure
    FROM epp_log_menus AS e
    INNER JOIN epp_menu    AS m ON e.epp_id_menu    = m.id_menu
    INNER JOIN epp_product AS p ON e.epp_id_product = p.id_product
    WHERE e.plu_menu = ?
    ORDER BY m.id_menu, e.plu_menu
`;

const SQL_INSERT_LOG_MENU = `
    INSERT INTO epp_log_menus (epp_id_menu, epp_id_product, plu_menu, type_base, status_log_menu)
    VALUES (?, ?, ?, ?, ?)
`;

const SQL_UPDATE_LOG_MENU = `
    UPDATE epp_log_menus
    SET epp_id_menu = ?, epp_id_product = ?, plu_menu = ?, type_base = ?, status_log_menu = ?
    WHERE epp_log_id = ?
`;

const SQL_DELETE_LOG_MENU_BY_ID = `DELETE FROM epp_log_menus WHERE epp_log_id = ?`;

const SQL_DELETE_LOG_MENU_BY_PLU = `
    DELETE FROM epp_log_menus WHERE plu_menu = ? AND epp_id_menu = ?
`;

// ─── Pedidos ──────────────────────────────────────────────────────────────────

const SQL_GET_ORDERS_PENDING = `
    SELECT * FROM epp_orders
    WHERE delivered = '0'
    ORDER BY delivery_date DESC, delivery_hour DESC
`;

function sqlGetOrdersPendingByStore(storeNumber) {
    return {
        sql: `SELECT * FROM epp_orders WHERE delivered = '0' AND delivery_store_number = ? ORDER BY delivery_date DESC, delivery_hour DESC`,
        params: [storeNumber]
    };
}

const SQL_GET_ORDER_BY_ID = `SELECT * FROM epp_orders WHERE id_order = ?`;

const SQL_INSERT_ORDER = `
    INSERT INTO epp_orders
        (user_id, store, store_number, name_client, date_order, delivery_date, delivery_hour,
         delivery_store, delivery_store_number, total, fone, email, signal_value, menu, id_menu, plu_menu,
         type_rice, description, delivered, dessert, observation, consinco_order_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const SQL_UPDATE_ORDER = `
    UPDATE epp_orders
    SET user_id = ?, store = ?, store_number = ?, name_client = ?, date_order = ?, delivery_date = ?,
        delivery_hour = ?, delivery_store = ?, delivery_store_number = ?, total = ?, fone = ?,
        email = ?, signal_value = ?, menu = ?, id_menu = ?, plu_menu = ?, type_rice = ?,
        description = ?, delivered = ?, dessert = ?, observation = ?
    WHERE id_order = ?
`;

const SQL_DELIVER_ORDER  = `UPDATE epp_orders SET delivered = 1 WHERE id_order = ?`;
const SQL_CANCEL_ORDER   = `UPDATE epp_orders SET delivered = 2, observation = 'Cancelado' WHERE id_order = ?`;
const SQL_DELETE_ORDER   = `DELETE FROM epp_orders WHERE id_order = ?`;

// ─── Log de Vendas (itens do pedido) ─────────────────────────────────────────

const SQL_GET_LOG_SALES_ALL = `SELECT * FROM epp_log_sale ORDER BY epp_id_log DESC`;

const SQL_GET_LOG_SALES_BY_ORDER = `
    SELECT * FROM epp_log_sale WHERE epp_id_order = ?
`;

/**
 * Query para a visão "Controller": itens de pedido com dados de ordem e produto.
 * Aceita filtros opcionais parametrizados.
 *
 * @param {object} filters - Campos opcionais: epp_id_product, epp_id_order, store,
 *   name_client, fone, delivery_store, delivered, date_order_from, date_order_to,
 *   delivery_date_from, delivery_date_to, delivery_hour_from, delivery_hour_to
 * @returns {{ sql: string, params: any[] }}
 */
function sqlGetControllerView(filters = {}) {
    const conditions = [];
    const params     = [];

    if (filters.epp_id_product != null) {
        conditions.push('s.epp_id_product = ?');
        params.push(filters.epp_id_product);
    }
    if (filters.epp_id_order != null) {
        conditions.push('s.epp_id_order = ?');
        params.push(filters.epp_id_order);
    }
    if (filters.store != null) {
        conditions.push('o.store = ?');
        params.push(filters.store);
    }
    if (filters.delivery_store != null) {
        conditions.push('o.delivery_store = ?');
        params.push(filters.delivery_store);
    }
    if (filters.name_client != null) {
        conditions.push('o.name_client LIKE ?');
        params.push(`%${filters.name_client}%`);
    }
    if (filters.fone != null) {
        conditions.push('o.fone = ?');
        params.push(filters.fone);
    }
    if (filters.delivered != null) {
        // Suporta múltiplos valores separados por vírgula: "0,1,2"
        const vals = String(filters.delivered).split(',').map(v => v.trim());
        conditions.push(`o.delivered IN (${vals.map(() => '?').join(',')})`);
        params.push(...vals);
    }
    // Ranges de data/hora
    if (filters.date_order_from != null && filters.date_order_to != null) {
        conditions.push('o.date_order BETWEEN ? AND ?');
        params.push(filters.date_order_from, filters.date_order_to);
    }
    if (filters.delivery_date_from != null && filters.delivery_date_to != null) {
        conditions.push('o.delivery_date BETWEEN ? AND ?');
        params.push(filters.delivery_date_from, filters.delivery_date_to);
    }
    if (filters.delivery_hour_from != null && filters.delivery_hour_to != null) {
        conditions.push('o.delivery_hour BETWEEN ? AND ?');
        params.push(filters.delivery_hour_from, filters.delivery_hour_to);
    }

    const baseWhere = `o.delivered IN ('0','1','2')`;
    const extra     = conditions.length ? ` AND ${conditions.join(' AND ')}` : '';

    return {
        sql: `
            SELECT
                s.epp_id_product,
                s.epp_id_order,
                s.menu,
                s.quantity,
                o.store,
                o.name_client,
                o.delivery_store,
                o.fone,
                o.date_order,
                o.delivery_date,
                o.delivery_hour,
                o.observation,
                o.delivered,
                p.description,
                p.measure
            FROM epp_log_sale AS s
            INNER JOIN epp_orders  AS o ON s.epp_id_order   = o.id_order
            INNER JOIN epp_product AS p ON s.epp_id_product = p.id_product
            WHERE ${baseWhere}${extra}
            ORDER BY o.delivery_date DESC, o.delivery_hour DESC
        `,
        params
    };
}

const SQL_GET_RECEIPE_EPP = `
    SELECT sale.epp_id_product, SUM(sale.quantity) AS quantity, sale.menu
    FROM global.epp_log_sale AS sale
    INNER JOIN global.epp_orders AS orders ON orders.id_order = sale.epp_id_order
    WHERE orders.delivered = 0
    GROUP BY sale.epp_id_product, sale.menu
`;

/**
 * Pedidos pendentes agregados por produto com filtros opcionais.
 * Base para o cálculo de produção mobile.
 *
 * @param {object} filters
 * @param {string} [filters.delivery_store]
 * @param {string} [filters.store]
 * @param {string} [filters.delivery_date_from]
 * @param {string} [filters.delivery_date_to]
 * @param {string} [filters.delivery_hour_from]
 * @param {string} [filters.delivery_hour_to]
 * @returns {{ sql: string, params: any[] }}
 */
function sqlGetReceipeEppFiltered(filters = {}) {
    const conditions = [];
    const params     = [];

    // delivered: padrão 0 (pendentes), aceita valor externo
    if (filters.delivered != null) {
        conditions.push('orders.delivered = ?');
        params.push(filters.delivered);
    } else {
        conditions.push('orders.delivered = 0');
    }

    if (filters.epp_id_order != null) {
        conditions.push('orders.id_order = ?');
        params.push(filters.epp_id_order);
    }
    if (filters.epp_id_product != null) {
        conditions.push('sale.epp_id_product = ?');
        params.push(filters.epp_id_product);
    }
    if (filters.delivery_store != null) {
        conditions.push('orders.delivery_store = ?');
        params.push(filters.delivery_store);
    }
    if (filters.store != null) {
        conditions.push('orders.store = ?');
        params.push(filters.store);
    }
    if (filters.delivery_date_from != null && filters.delivery_date_to != null) {
        conditions.push('orders.delivery_date BETWEEN ? AND ?');
        params.push(filters.delivery_date_from, filters.delivery_date_to);
    } else if (filters.delivery_date_from != null) {
        conditions.push('orders.delivery_date >= ?');
        params.push(filters.delivery_date_from);
    } else if (filters.delivery_date_to != null) {
        conditions.push('orders.delivery_date <= ?');
        params.push(filters.delivery_date_to);
    }
    if (filters.delivery_hour_from != null && filters.delivery_hour_to != null) {
        conditions.push('orders.delivery_hour BETWEEN ? AND ?');
        params.push(filters.delivery_hour_from, filters.delivery_hour_to);
    }

    return {
        sql: `
            SELECT sale.epp_id_product, SUM(sale.quantity) AS quantity, sale.menu
            FROM global.epp_log_sale AS sale
            INNER JOIN global.epp_orders AS orders ON orders.id_order = sale.epp_id_order
            WHERE ${conditions.join(' AND ')}
            GROUP BY sale.epp_id_product, sale.menu
        `,
        params,
    };
}

const SQL_INSERT_LOG_SALE = `
    INSERT INTO epp_log_sale (epp_id_order, epp_id_product, quantity, price, menu)
    VALUES (?, ?, ?, ?, ?)
`;

const SQL_UPDATE_LOG_SALE = `
    UPDATE epp_log_sale
    SET epp_id_order = ?, epp_id_product = ?, quantity = ?, price = ?, menu = ?
    WHERE epp_id_log = ?
`;

const SQL_DELETE_LOG_SALE_BY_ID    = `DELETE FROM epp_log_sale WHERE epp_id_log = ?`;
const SQL_DELETE_LOG_SALE_BY_ORDER = `DELETE FROM epp_log_sale WHERE epp_id_order = ?`;

// ─── Estoque ──────────────────────────────────────────────────────────────────

/**
 * Query base do estoque atual (com dados de venda pendente).
 * Retorna valores numéricos brutos (sem FORMAT) para permitir comparações seguras.
 */
const SQL_STOCK_BASE = `
    SELECT
        stk.id_product_fk,
        stk.serie,
        stk.status_stock,
        prod.description,
        prod.id_category_fk AS category,
        prod.measure,
        prod.status_prod,
        COALESCE(log_sales.total_quantity, 0)           AS quantity,
        ROUND(SUM(stk.stock_quantity), 3)               AS stock_quantity,
        ROUND(SUM(IF(stk.stock_quantity > 0, stk.stock_quantity, 0)), 3) AS input_quantity,
        ROUND(SUM(IF(stk.stock_quantity < 0, stk.stock_quantity, 0)), 3) AS output_quantity
    FROM global.epp_stock AS stk
    LEFT JOIN global.epp_product AS prod ON stk.id_product_fk = prod.id_product
    LEFT JOIN (
        SELECT lgs.epp_id_product, SUM(lgs.quantity) AS total_quantity
        FROM global.epp_log_sale AS lgs
        INNER JOIN global.epp_orders AS ord ON lgs.epp_id_order = ord.id_order
        WHERE ord.delivered = 0
        GROUP BY lgs.epp_id_product
    ) AS log_sales ON stk.id_product_fk = log_sales.epp_id_product
    WHERE stk.status_stock = 1 AND stk.stock_delete = 0
`;

const SQL_GET_STOCK = `
    ${SQL_STOCK_BASE}
    GROUP BY
        stk.id_product_fk, stk.serie, stk.status_stock,
        prod.description, prod.id_category_fk, prod.measure, prod.status_prod,
        log_sales.total_quantity
    ORDER BY prod.description
`;

const SQL_GET_STOCK_BY_PRODUCT = `
    ${SQL_STOCK_BASE}
    AND stk.id_product_fk = ?
    GROUP BY
        stk.id_product_fk, stk.serie, stk.status_stock,
        prod.description, prod.id_category_fk, prod.measure, prod.status_prod,
        log_sales.total_quantity
`;

const SQL_GET_STOCK_BY_ID_STOCK = `
    ${SQL_STOCK_BASE}
    AND stk.id_product_fk = (SELECT s.id_product_fk FROM global.epp_stock s WHERE s.id_stock = ?)
    GROUP BY
        stk.id_product_fk, stk.serie, stk.status_stock,
        prod.description, prod.id_category_fk, prod.measure, prod.status_prod,
        log_sales.total_quantity
`;

const SQL_GET_STOCK_HISTORY = `
    SELECT
        stk.*,
        prod.measure,
        creators.name AS creators_name,
        editors.name  AS editors_name
    FROM global.epp_stock AS stk
    LEFT JOIN global._employee AS creators ON stk.created_by = creators.id
    LEFT JOIN global._employee AS editors  ON stk.updated_by = editors.id
    LEFT JOIN global.epp_product AS prod   ON stk.id_product_fk = prod.id_product
    WHERE stk.id_product_fk = ? AND stk.stock_delete = 0
    ORDER BY stk.id_stock DESC
`;

const SQL_GET_PENDING_PRODUCTION = `
    SELECT * FROM global.epp_product
    WHERE id_product NOT IN (
        SELECT DISTINCT stk.id_product_fk
        FROM global.epp_stock AS stk
        WHERE stk.stock_delete = 0 AND stk.status_stock = 1
    )
    AND status_prod = 1
    AND id_category_fk NOT IN (1)
    ORDER BY description
    LIMIT ?, ?
`;

const SQL_COUNT_PENDING_PRODUCTION = `
    SELECT COUNT(*) AS total FROM global.epp_product
    WHERE id_product NOT IN (
        SELECT DISTINCT stk.id_product_fk
        FROM global.epp_stock AS stk
        WHERE stk.stock_delete = 0 AND stk.status_stock = 1
    )
    AND status_prod = 1
    AND id_category_fk NOT IN (1)
`;

const SQL_GET_MENUS_FOR_STOCK = `
    SELECT sale.epp_id_product, SUM(sale.quantity) AS quantity
    FROM global.epp_log_sale AS sale
    INNER JOIN global.epp_orders AS orders ON orders.id_order = sale.epp_id_order
    WHERE orders.delivered = 0 AND sale.menu = 1
    GROUP BY sale.epp_id_product
`;

const SQL_INSERT_STOCK = `
    INSERT INTO global.epp_stock (id_product_fk, stock_quantity, created_by, updated_by)
    VALUES (?, ?, ?, ?)
`;

/**
 * Constrói query de UPDATE dinâmico para estoque.
 * @param {object} fields - campos a atualizar (exceto id_stock)
 * @returns {{ sql: string, params: any[] }}
 */
function sqlUpdateStock(idStock, fields) {
    const allowed = ['id_product_fk', 'stock_quantity', 'updated_by', 'status_stock', 'stock_delete', 'serie'];
    const setClauses = [];
    const params     = [];

    for (const key of allowed) {
        if (fields[key] !== undefined) {
            setClauses.push(`${key} = ?`);
            params.push(fields[key]);
        }
    }

    if (setClauses.length === 0) throw new Error('sqlUpdateStock: nenhum campo para atualizar');

    params.push(idStock);
    return {
        sql: `UPDATE global.epp_stock SET ${setClauses.join(', ')} WHERE id_stock = ?`,
        params
    };
}

module.exports = {
    // Produtos
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
    // Menus
    SQL_GET_MENUS_ACTIVE,
    SQL_GET_MENUS_ALL,
    sqlSearchMenus,
    SQL_INSERT_MENU,
    SQL_UPDATE_MENU,
    SQL_DELETE_MENU,
    // Log Menus
    SQL_GET_LOG_MENUS,
    SQL_GET_LOG_MENUS_BY_PLU,
    SQL_INSERT_LOG_MENU,
    SQL_UPDATE_LOG_MENU,
    SQL_DELETE_LOG_MENU_BY_ID,
    SQL_DELETE_LOG_MENU_BY_PLU,
    // Pedidos
    SQL_GET_ORDERS_PENDING,
    sqlGetOrdersPendingByStore,
    SQL_GET_ORDER_BY_ID,
    SQL_INSERT_ORDER,
    SQL_UPDATE_ORDER,
    SQL_DELIVER_ORDER,
    SQL_CANCEL_ORDER,
    SQL_DELETE_ORDER,
    // Log Vendas
    SQL_GET_LOG_SALES_ALL,
    SQL_GET_LOG_SALES_BY_ORDER,
    sqlGetControllerView,
    SQL_GET_RECEIPE_EPP,
    sqlGetReceipeEppFiltered,
    SQL_INSERT_LOG_SALE,
    SQL_UPDATE_LOG_SALE,
    SQL_DELETE_LOG_SALE_BY_ID,
    SQL_DELETE_LOG_SALE_BY_ORDER,
    // Estoque
    SQL_GET_STOCK,
    SQL_GET_STOCK_BY_PRODUCT,
    SQL_GET_STOCK_BY_ID_STOCK,
    SQL_GET_STOCK_HISTORY,
    SQL_GET_PENDING_PRODUCTION,
    SQL_COUNT_PENDING_PRODUCTION,
    SQL_GET_MENUS_FOR_STOCK,
    SQL_INSERT_STOCK,
    sqlUpdateStock,
    // Ecommerce
    sqlGetProductsInfo,
};

function sqlGetProductsInfo(seqProdutos) {
    const placeholders = seqProdutos.map(() => '?').join(', ');
    return {
        sql: `SELECT id_product, IF(id_category_fk = 1, 1, 0) AS is_menu
              FROM global.epp_product
              WHERE id_product IN (${placeholders})`,
        params: seqProdutos,
    };
}
