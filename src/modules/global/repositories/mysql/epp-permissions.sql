-- ============================================================
-- Permissões do módulo EPP (Encomendas por Pedido)
-- Execute uma vez no banco `global`
-- ============================================================

INSERT IGNORE INTO `_permissions` (code, description) VALUES
    ('EPP_USE',       'Acesso geral ao módulo EPP — consultar produtos, menus, categorias e estoque'),
    ('EPP_ORDERS',    'Módulo EPP — ver, criar e atualizar pedidos e itens de venda (log_sales)'),
    ('EPP_PRODUCTS',  'Módulo EPP — cadastrar e editar produtos, menus e configurações de cardápio (log_menus)'),
    ('EPP_VIEW_RECIPE',   'Módulo EPP — acessar receitas técnicas Oracle (mobile e oracle_receipe)'),
    ('EPP_MANAGE',    'Administração total do EPP — exclusões, correções de estoque e operações destrutivas'),
    ('EPP_USE_ECOMMERCE', 'Módulo EPP — acesso ao fluxo de confirmação de pedidos e-commerce (Consinco)');

-- ─────────────────────────────────────────────────────────────────────────────
-- Resumo das permissões por funcionalidade:
--
--  EPP_USE        → Leitura de produtos, menus, log_menus, estoque
--  EPP_ORDERS     → Pedidos: GET/POST/PUT/PATCH orders
--                   Itens de venda: GET/POST/PUT/DELETE log_sales (exceto DELETE by order)
--  EPP_PRODUCTS   → Produtos: POST/PUT/PATCH/DELETE products
--                   Menus: POST/PUT/DELETE menus
--                   Itens de cardápio: POST/PUT/DELETE log_menus
--  EPP_VIEW_RECIPE    → Log_sales com ?mobile=1 ou ?oracle_receipe=1 (receitas Oracle)
--  EPP_MANAGE     → Tudo + exclusões destrutivas + ajustes de estoque
--  EPP_USE_ECOMMERCE  → Fluxo de confirmação de pedidos e-commerce (Consinco)
-- ─────────────────────────────────────────────────────────────────────────────

-- Para associar as permissões a um papel existente (ex: SYSTEM_OWNER):
--
-- INSERT IGNORE INTO `_role_permissions` (role_id, permission_id)
-- SELECT r.id, p.id
-- FROM `_roles` r, `_permissions` p
-- WHERE r.name = 'SYSTEM_OWNER'
--   AND p.code IN ('EPP_USE', 'EPP_ORDERS', 'EPP_PRODUCTS', 'EPP_VIEW_RECIPE', 'EPP_MANAGE', 'EPP_USE_ECOMMERCE');

-- ============================================================
-- CORREÇÃO PARA AMBIENTES ONDE ESTE SCRIPT JÁ FOI EXECUTADO
-- (banco já tem uma permissão seedada com o código errado 'MANAGE_EPP',
--  e nunca teve 'EPP_USE_ECOMMERCE'). Execute manualmente em produção:
-- ============================================================
--
-- UPDATE `_permissions` SET code = 'EPP_MANAGE' WHERE code = 'MANAGE_EPP';
--
-- INSERT IGNORE INTO `_permissions` (code, description) VALUES
--     ('EPP_USE_ECOMMERCE', 'Módulo EPP — acesso ao fluxo de confirmação de pedidos e-commerce (Consinco)');
--
-- -- Associa EPP_USE_ECOMMERCE aos mesmos papéis que já têm EPP_MANAGE:
-- INSERT IGNORE INTO `_role_permissions` (role_id, permission_id)
-- SELECT rp.role_id, p.id
-- FROM `_role_permissions` rp
-- JOIN `_permissions` existing ON existing.id = rp.permission_id AND existing.code = 'EPP_MANAGE'
-- JOIN `_permissions` p ON p.code = 'EPP_USE_ECOMMERCE';
