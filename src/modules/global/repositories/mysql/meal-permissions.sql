-- ============================================================
-- Controle de refeitório — permissões, papéis e acesso ao app
-- Execute uma vez no banco `global` (10.10.10.99)
--
-- Contexto: etapa 2 do plano de refeitório. O modelo de dados (etapa 1) já está
-- em produção no SQL Server `GIPP.dbo` — meal_log, meal_diner_group e
-- vw_meal_diner. Este script libera o acesso às rotas do módulo `meal`.
--
-- Quem usa o quê:
--   operador do refeitório .... lê a lista, lê os botões, registra a refeição
--   RH ....................... cadastra os botões e lê o relatório (etapa 4)
--
-- Rotas cobertas:
--   GET   /api/v1/gipp/meal/sites/:siteCode                             MEAL_SERVE
--   GET   /api/v1/gipp/meal/diners                                      MEAL_SERVE
--   GET   /api/v1/gipp/meal/diners/:company/:branch/:employee           MEAL_SERVE
--   GET   /api/v1/gipp/meal/diner-groups                                MEAL_SERVE | MEAL_MANAGE_GROUPS
--   POST  /api/v1/gipp/meal/logs                                        MEAL_SERVE
--   POST  /api/v1/gipp/meal/logs/sync                                   MEAL_SERVE
--   POST  /api/v1/gipp/meal/diner-groups                                MEAL_MANAGE_GROUPS
--   PATCH /api/v1/gipp/meal/diner-groups/:id                            MEAL_MANAGE_GROUPS
--   GET   /api/v1/gipp/meal/reports/daily                               MEAL_VIEW_REPORT
--   GET   /api/v1/gipp/meal/reports/cost-center                         MEAL_VIEW_REPORT
--   GET   /api/v1/gipp/meal/reports/payee                               MEAL_VIEW_REPORT
--   GET   /api/v1/gipp/meal/reports/exceptions                          MEAL_VIEW_REPORT
--   GET   /api/v1/gipp/meal/coupons                                     MEAL_VIEW_REPORT
--   DELETE /api/v1/gipp/meal/coupons/:id                               MEAL_MANAGE
--
-- O DELETE de cupom é a única exclusão de verdade do módulo: apaga a linha de
-- saldo e a refeição que ela gerou. Por isso MEAL_MANAGE, e por isso não entra
-- no papel MEAL_RH abaixo — quem estorna é quem administra o refeitório.
-- ============================================================

-- ─── 1. Permissões ────────────────────────────────────────────────────────────
INSERT IGNORE INTO `_permissions` (code, description) VALUES
    ('MEAL_SERVE',
     'Registrar refeicoes servidas no refeitorio e consultar comensais e botoes de grupo'),
    ('MEAL_MANAGE_GROUPS',
     'Cadastrar e editar os grupos sem matricula (jovem aprendiz, seguranca, visitante)'),
    ('MEAL_VIEW_REPORT',
     'Consultar os relatorios de refeicoes por dia, filial, centro de custo e contratante'),
    ('MEAL_MANAGE',
     'Administracao total do controle de refeitorio');

-- ─── 2. Papéis ────────────────────────────────────────────────────────────────
-- Dois papéis, porque são duas pessoas diferentes com aparelhos diferentes: o
-- operador tem o celular na porta do refeitório, o RH tem o navegador.
INSERT IGNORE INTO `_roles` (name, description) VALUES
    ('MEAL_OPERADOR',
     'Operador do refeitorio — registra as refeicoes servidas no aparelho'),
    ('MEAL_RH',
     'RH do refeitorio — cadastra os grupos e consulta os relatorios');

-- ─── 3. Permissões do operador ────────────────────────────────────────────────
-- Só MEAL_SERVE. Ele não cadastra balde nem lê relatório: a tela dele tem
-- leitor de QR e botões, e mais nada.
INSERT IGNORE INTO `_role_permissions` (role_id, permission_id)
SELECT r.id, p.id
  FROM `_roles` r
 CROSS JOIN `_permissions` p
 WHERE r.name = 'MEAL_OPERADOR'
   AND p.code IN ('MEAL_SERVE');

-- ─── 4. Permissões do RH ──────────────────────────────────────────────────────
-- MEAL_SERVE entra também para o RH poder conferir a lista e os botões como o
-- operador os vê — sem isso, todo suporte a "o botão não aparece" vira pedido de
-- print de tela.
INSERT IGNORE INTO `_role_permissions` (role_id, permission_id)
SELECT r.id, p.id
  FROM `_roles` r
 CROSS JOIN `_permissions` p
 WHERE r.name = 'MEAL_RH'
   AND p.code IN ('MEAL_SERVE', 'MEAL_MANAGE_GROUPS', 'MEAL_VIEW_REPORT');

-- ─── 5. Aplicação (appId 30) — JÁ EXISTE, não criar ───────────────────────────
-- Conferido em 18/08/2026: a linha 30 já está cadastrada como
--   id=30 · description='MEAL_USE' · full_description='Monitoramento Empresarial Alimentar'
--
-- A tabela é (id, description, full_description, version) — NÃO tem coluna
-- `name`. Para conferir:
--
--   SELECT * FROM `_application` WHERE id = 30;

-- ─── 6. Liberar quem vai usar ─────────────────────────────────────────────────
--
-- ⚠️ Este passo é obrigatório para TODO MUNDO, inclusive para quem tem
--   SYSTEM_OWNER. São dois portões independentes:
--
--     `permissions`     → o que a rota aceita. SYSTEM_OWNER faz bypass
--                         (ver MASTER_PERMISSION em permission.middleware.js).
--     `application_ids` → quais cards a Home exibe. NÃO tem bypass: vem só de
--                         `_application_access`, via GROUP_CONCAT na
--                         `sp_get_user_authorization`.
--
--   Sem a linha abaixo o módulo funciona, as rotas respondem, e o card não
--   aparece na tela de ninguém — nem do proprietário do sistema.
--
-- INSERT IGNORE INTO `_application_access` (application_id, user_id)
-- SELECT 30, u.id FROM `_user` u WHERE u.user = 'usuario.do.operador';

-- ─── 7. Atribuir o papel ──────────────────────────────────────────────────────
-- Dispensável para quem tem SYSTEM_OWNER; necessário para o operador e para o
-- RH, que não têm.
--
-- INSERT IGNORE INTO `_user_roles` (user_id, role_id)
-- SELECT u.id, r.id
--   FROM `_user` u CROSS JOIN `_roles` r
--  WHERE u.user = 'usuario.do.operador'
--    AND r.name = 'MEAL_OPERADOR';

-- ─── Conferência ──────────────────────────────────────────────────────────────
-- SELECT r.name AS papel, p.code AS permissao
--   FROM `_role_permissions` rp
--   JOIN `_roles`       r ON r.id = rp.role_id
--   JOIN `_permissions` p ON p.id = rp.permission_id
--  WHERE r.name IN ('MEAL_OPERADOR', 'MEAL_RH')
--  ORDER BY r.name, p.code;

-- ─── Rollback ─────────────────────────────────────────────────────────────────
-- DELETE rp FROM `_role_permissions` rp
--   JOIN `_permissions` p ON p.id = rp.permission_id
--  WHERE p.code LIKE 'MEAL\_%';
-- DELETE FROM `_user_roles` WHERE role_id IN
--     (SELECT id FROM `_roles` WHERE name IN ('MEAL_OPERADOR', 'MEAL_RH'));
-- DELETE FROM `_roles`       WHERE name IN ('MEAL_OPERADOR', 'MEAL_RH');
-- DELETE FROM `_permissions` WHERE code LIKE 'MEAL\_%';
