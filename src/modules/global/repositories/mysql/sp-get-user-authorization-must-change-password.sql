-- ============================================================
-- Corrige sp_get_user_authorization para devolver must_change_password
-- Execute uma vez no banco `global` (10.10.10.99)
--
-- PROBLEMA
--   O login não lê `_user` direto: chama `sp_get_user_authorization`, que tem
--   lista explícita de colunas. `must_change_password` foi acrescentada à tabela
--   mas não à procedure, então o payload de sessão recebia `undefined` e o
--   `Boolean()` do mapper transformava isso em `false` — silenciosamente.
--
--   Consequência: as duas defesas da troca obrigatória ficaram inativas de uma
--   vez, porque ambas leem do token e não da tabela:
--     - GET /me devolvia must_change_password: false
--     - o middleware não barrava rota nenhuma
--
--   Reproduzido em 18/08/2026 com o usuário 68 (dev_ti):
--     tabela ......... must_change_password = 1
--     retorno da SP .. undefined
--     no token ....... false
--
-- CORREÇÃO
--   Acrescenta `u.must_change_password` ao SELECT e ao GROUP BY. Nada mais muda:
--   os JOINs, os GROUP_CONCAT e o WHERE ficam idênticos.
--
--   O código Node não precisa de alteração — o `Boolean()` do mapper já converte
--   o TINYINT (0/1) corretamente assim que o campo passa a existir.
--
-- Rollback ao final do arquivo.
-- ============================================================

DROP PROCEDURE IF EXISTS `sp_get_user_authorization`;

DELIMITER $$

CREATE PROCEDURE `sp_get_user_authorization`(IN p_ad_guid VARCHAR(128))
BEGIN

    SELECT
    u.id,
    u.user,
    u.name,
    u.branch_code,
    u.registration,
    u.ad_status,
    u.must_change_password,
    GROUP_CONCAT(DISTINCT acc.application_id ORDER BY acc.application_id) AS application_ids,
    GROUP_CONCAT(DISTINCT r.name        ORDER BY r.name        SEPARATOR ',') AS roles,
    GROUP_CONCAT(DISTINCT p.code        ORDER BY p.code        SEPARATOR ',') AS permissions
FROM _user u
JOIN _user_roles ur         ON ur.user_id = u.id
JOIN _roles r               ON r.id = ur.role_id
INNER JOIN _application_access acc ON acc.user_id = u.id
LEFT JOIN _role_permissions rp ON rp.role_id = r.id
LEFT JOIN _permissions p    ON p.id = rp.permission_id
WHERE (u.ad_guid = p_ad_guid OR u.id = p_ad_guid)
GROUP BY u.id, u.user, u.name, u.registration, u.branch_code, u.ad_status, u.must_change_password;

END$$

DELIMITER ;


-- ─── Conferência ──────────────────────────────────────────────────────────────
-- Deve trazer a coluna e o valor 1 para o usuário 68:
--
--   CALL sp_get_user_authorization('68');
--
-- E o valor na tabela, para comparar:
--
--   SELECT id, user, must_change_password FROM `_user` WHERE id = 68;
--
-- ⚠️ Sessões já abertas continuam com o token antigo (must_change_password
-- false). Quem estiver logado precisa sair e entrar de novo para a flag valer.


-- ─── Rollback ─────────────────────────────────────────────────────────────────
-- Restaura a definição anterior, sem a coluna:
--
-- DROP PROCEDURE IF EXISTS `sp_get_user_authorization`;
-- DELIMITER $$
-- CREATE PROCEDURE `sp_get_user_authorization`(IN p_ad_guid VARCHAR(128))
-- BEGIN
--     SELECT
--     u.id, u.user, u.name, u.branch_code, u.registration, u.ad_status,
--     GROUP_CONCAT(DISTINCT acc.application_id ORDER BY acc.application_id) AS application_ids,
--     GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ',') AS roles,
--     GROUP_CONCAT(DISTINCT p.code ORDER BY p.code SEPARATOR ',') AS permissions
-- FROM _user u
-- JOIN _user_roles ur ON ur.user_id = u.id
-- JOIN _roles r ON r.id = ur.role_id
-- INNER JOIN _application_access acc ON acc.user_id = u.id
-- LEFT JOIN _role_permissions rp ON rp.role_id = r.id
-- LEFT JOIN _permissions p ON p.id = rp.permission_id
-- WHERE (u.ad_guid = p_ad_guid OR u.id = p_ad_guid)
-- GROUP BY u.id, u.user, u.name, u.registration, u.branch_code, u.ad_status;
-- END$$
-- DELIMITER ;
