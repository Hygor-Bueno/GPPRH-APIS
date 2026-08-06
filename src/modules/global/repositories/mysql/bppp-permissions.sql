-- ============================================================
-- Permissões do módulo BPPP (Busca de Preço Peg Pesé)
-- Execute uma vez no banco `global` (10.10.10.99)
-- Rota coberta: GET /api/v1/global/bppp/products
-- ============================================================

INSERT IGNORE INTO `_permissions` (code, description) VALUES
    ('USE_BPPP',    'Módulo BPPP — consultar preço, estoque e código de barras de produto no Consinco'),
    ('BPPP_MANAGE', 'Administração total do BPPP — inclui a consulta e futuras operações do módulo');

-- ─────────────────────────────────────────────────────────────────────────────
-- Resumo das permissões por funcionalidade:
--
--  USE_BPPP     → GET /bppp/products (busca por plu | ean | description)
--  BPPP_MANAGE  → Tudo do módulo (hoje equivale a USE_BPPP)
--
--  Observação: SYSTEM_OWNER continua com bypass total (permission.middleware).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Vínculo com papéis ───────────────────────────────────────────────────────
-- 1) Papéis administrativos recebem BPPP_MANAGE + USE_BPPP.
--    Ajuste a lista de `r.name` conforme os papéis existentes no ambiente.
INSERT IGNORE INTO `_role_permissions` (role_id, permission_id)
SELECT r.id, p.id
  FROM `_roles` r
 CROSS JOIN `_permissions` p
 WHERE r.name IN ('SYSTEM_OWNER', 'ADMIN')
   AND p.code IN ('USE_BPPP', 'BPPP_MANAGE');

-- 2) Todo papel que já pode consultar produto no EPP também pode consultar
--    preço no BPPP (mesma natureza de leitura no Consinco).
INSERT IGNORE INTO `_role_permissions` (role_id, permission_id)
SELECT rp.role_id, p.id
  FROM `_role_permissions` rp
  JOIN `_permissions` existing ON existing.id = rp.permission_id
                              AND existing.code = 'USE_EPP'
  JOIN `_permissions` p        ON p.code = 'USE_BPPP';

-- ─── Conferência ──────────────────────────────────────────────────────────────
-- Quais papéis ficaram com as permissões do BPPP:
--
-- SELECT r.name AS papel, p.code AS permissao
--   FROM `_role_permissions` rp
--   JOIN `_roles`       r ON r.id = rp.role_id
--   JOIN `_permissions` p ON p.id = rp.permission_id
--  WHERE p.code IN ('USE_BPPP', 'BPPP_MANAGE')
--  ORDER BY r.name, p.code;
--
-- Quais usuários passaram a ter acesso (via papéis):
--
-- SELECT DISTINCT u.id, u.name, p.code
--   FROM `_user_roles`       ur
--   JOIN `_user`             u  ON u.id  = ur.user_id
--   JOIN `_role_permissions` rp ON rp.role_id = ur.role_id
--   JOIN `_permissions`      p  ON p.id  = rp.permission_id
--  WHERE p.code IN ('USE_BPPP', 'BPPP_MANAGE')
--  ORDER BY u.name;

-- ─── Rollback ─────────────────────────────────────────────────────────────────
-- DELETE rp FROM `_role_permissions` rp
--   JOIN `_permissions` p ON p.id = rp.permission_id
--  WHERE p.code IN ('USE_BPPP', 'BPPP_MANAGE');
-- DELETE FROM `_permissions` WHERE code IN ('USE_BPPP', 'BPPP_MANAGE');
