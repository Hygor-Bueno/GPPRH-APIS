-- ============================================================
-- Permissões do módulo EPP (Encomendas por Pedido)
-- Execute uma vez no banco `global`
-- ============================================================

INSERT IGNORE INTO `_permissions` (code, description) VALUES
    ('USE_EPP',      'Acesso geral ao módulo EPP — consultar produtos, menus, categorias e estoque'),
    ('EPP_ORDERS',   'Módulo EPP — ver, criar e atualizar pedidos e itens de venda (log_sales)'),
    ('EPP_PRODUCTS', 'Módulo EPP — cadastrar e editar produtos, menus e configurações de cardápio (log_menus)'),
    ('EPP_RECEIPE',  'Módulo EPP — acessar receitas técnicas Oracle (mobile e oracle_receipe)'),
    ('MANAGE_EPP',   'Administração total do EPP — exclusões, correções de estoque e operações destrutivas');

-- ─────────────────────────────────────────────────────────────────────────────
-- Resumo das permissões por funcionalidade:
--
--  USE_EPP        → Leitura de produtos, menus, log_menus, estoque
--  EPP_ORDERS     → Pedidos: GET/POST/PUT/PATCH orders
--                   Itens de venda: GET/POST/PUT/DELETE log_sales (exceto DELETE by order)
--  EPP_PRODUCTS   → Produtos: POST/PUT/PATCH/DELETE products
--                   Menus: POST/PUT/DELETE menus
--                   Itens de cardápio: POST/PUT/DELETE log_menus
--  EPP_RECEIPE    → Log_sales com ?mobile=1 ou ?oracle_receipe=1 (receitas Oracle)
--  MANAGE_EPP     → Tudo + exclusões destrutivas + ajustes de estoque
-- ─────────────────────────────────────────────────────────────────────────────

-- Para associar as permissões a um papel existente (ex: SYSTEM_OWNER):
--
-- INSERT IGNORE INTO `_role_permissions` (role_id, permission_id)
-- SELECT r.id, p.id
-- FROM `_roles` r, `_permissions` p
-- WHERE r.name = 'SYSTEM_OWNER'
--   AND p.code IN ('USE_EPP', 'EPP_ORDERS', 'EPP_PRODUCTS', 'EPP_RECEIPE', 'MANAGE_EPP');
