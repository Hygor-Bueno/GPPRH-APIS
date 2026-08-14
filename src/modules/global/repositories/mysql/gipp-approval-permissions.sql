-- ============================================================
-- Etapa de aprovação do gerente no fluxo de ponto (GIPP / CFPP)
-- Execute uma vez no banco `global` (10.10.10.99)
--
-- Contexto: até 08/2026 o fluxo era encarregado lança -> RH finaliza.
-- Passa a existir um passo intermediário de aprovação pelo gerente:
--
--   encarregado lança .......... status 1 -> 2 (automático ao bater a saída)
--   gerente aprova ............. status 2 -> 3
--   gerente reprova ............ status 2 -> 5
--   RH finaliza ................ status 3 -> 4
--
-- Rotas cobertas:
--   GET   /api/v1/gipp/time-records/payment/pending-approval   (gerente, status 2)
--   GET   /api/v1/gipp/time-records/payment/approved           (RH, status 3)
--   PATCH /api/v1/gipp/time-records/approve                    (gerente — etapa 6)
-- ============================================================

-- ─── 1. Permissão nova ────────────────────────────────────────────────────────
INSERT IGNORE INTO `_permissions` (code, description) VALUES
    ('GIPP_APPROVE_TIMERECORD',
     'Aprovar ou reprovar jornadas de ponto fechadas pelo encarregado (fila do gerente)');

-- ─── 2. Papel novo ────────────────────────────────────────────────────────────
-- Não existe papel de gerente para o CFPP hoje: os papéis do módulo são
-- CFPP_OPERADOR (encarregado) e CFPP_RH. O passo de aprovação precisa de um
-- terceiro. Ajuste o nome se a convenção do ambiente for outra.
INSERT IGNORE INTO `_roles` (name, description) VALUES
    ('CFPP_GERENTE',
     'Gerente de loja — aprova ou reprova as jornadas lançadas pelos encarregados');

-- ─── 3. Permissões do gerente ─────────────────────────────────────────────────
--  GIPP_APPROVE_TIMERECORD → ver a fila de aprovação e aprovar (2 -> 3)
--  GIPP_VIEW_TIMERECORD    → abrir a jornada e conferir as marcações
--  GIPP_DISCARD_TIMERECORD → reprovar (2 -> 5), mesma rota de desconsiderar
INSERT IGNORE INTO `_role_permissions` (role_id, permission_id)
SELECT r.id, p.id
  FROM `_roles` r
 CROSS JOIN `_permissions` p
 WHERE r.name = 'CFPP_GERENTE'
   AND p.code IN ('GIPP_APPROVE_TIMERECORD',
                  'GIPP_VIEW_TIMERECORD',
                  'GIPP_DISCARD_TIMERECORD');

-- ─── 4. RH continua enxergando a fila de aprovação ────────────────────────────
-- CFPP_RH já possui GIPP_MANAGE_TIMERECORD, que a rota pending-approval aceita
-- via canAny — então o RH não fica cego para o que está parado com o gerente.
-- A linha abaixo é opcional e só torna isso explícito em vez de implícito.
--
-- INSERT IGNORE INTO `_role_permissions` (role_id, permission_id)
-- SELECT r.id, p.id FROM `_roles` r CROSS JOIN `_permissions` p
--  WHERE r.name = 'CFPP_RH' AND p.code = 'GIPP_APPROVE_TIMERECORD';

-- ─── Conferência ──────────────────────────────────────────────────────────────
-- SELECT r.name AS papel, p.code AS permissao
--   FROM `_role_permissions` rp
--   JOIN `_roles`       r ON r.id = rp.role_id
--   JOIN `_permissions` p ON p.id = rp.permission_id
--  WHERE r.name IN ('CFPP_OPERADOR', 'CFPP_GERENTE', 'CFPP_RH')
--    AND p.code LIKE 'GIPP\_%'
--  ORDER BY r.name, p.code;

-- ─── Rollback ─────────────────────────────────────────────────────────────────
-- DELETE rp FROM `_role_permissions` rp
--   JOIN `_permissions` p ON p.id = rp.permission_id
--  WHERE p.code = 'GIPP_APPROVE_TIMERECORD';
-- DELETE rp FROM `_role_permissions` rp
--   JOIN `_roles` r ON r.id = rp.role_id
--  WHERE r.name = 'CFPP_GERENTE';
-- DELETE FROM `_user_roles` WHERE role_id = (SELECT id FROM `_roles` WHERE name = 'CFPP_GERENTE');
-- DELETE FROM `_roles`       WHERE name = 'CFPP_GERENTE';
-- DELETE FROM `_permissions` WHERE code = 'GIPP_APPROVE_TIMERECORD';
