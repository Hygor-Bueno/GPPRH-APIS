-- Permissões do módulo MIEPP. Execute uma vez no banco `global`.

INSERT IGNORE INTO `_permissions` (code, description) VALUES
    ('MIEPP_USE',    'Acesso de leitura ao módulo MIEPP'),
    ('MIEPP_MANAGE', 'Criação e alteração de conteúdo e players no MIEPP'),
    ('MIEPP_ADMIN',  'Operações administrativas do MIEPP, incluindo auditoria');

-- O proprietário do sistema mantém acesso total pelo bypass do middleware.
-- Ajuste os nomes dos papéis conforme a política de acesso do ambiente.
INSERT IGNORE INTO `_role_permissions` (role_id, permission_id)
SELECT r.id, p.id
  FROM `_roles` r
 CROSS JOIN `_permissions` p
 WHERE r.name IN ('SYSTEM_OWNER', 'ADMIN')
   AND p.code IN ('MIEPP_USE', 'MIEPP_MANAGE', 'MIEPP_ADMIN');