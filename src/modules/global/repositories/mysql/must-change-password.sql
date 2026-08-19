-- ============================================================
-- Troca de senha obrigatória no primeiro acesso após reset
-- Execute uma vez no banco `global` (10.10.10.99)
--
-- Contexto: a gestão de acessos passa a poder resetar a senha de um usuário
-- LOCAL. O reset gera uma senha aleatória por usuário (nunca uma senha padrão
-- compartilhada) e liga a flag abaixo. O login devolve a flag, o front abre a
-- tela de troca, e o middleware barra as demais rotas até a troca acontecer.
-- ============================================================

-- ─── 1. A flag ────────────────────────────────────────────────────────────────
-- Já aplicada em 14/08/2026. Rodar de novo dá "Duplicate column name".
-- Para conferir antes:
--   SELECT COLUMN_NAME FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA = 'global' AND TABLE_NAME = '_user'
--      AND COLUMN_NAME = 'must_change_password';
ALTER TABLE `_user`
    ADD COLUMN `must_change_password` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Quando 1, o usuário só acessa /me, /logout e /change-password'
    AFTER `password`;


-- ─── 2. Marcar as contas com senha em texto puro ──────────────────────────────
-- Hash bcrypt sempre começa com $2a$ / $2b$ / $2y$. O que não começa assim está
-- gravado em texto puro — hoje são 37 contas, todas com a senha '1234' herdada
-- do DEFAULT da coluna. Ligar a flag nelas obriga a troca no próximo login, sem
-- precisar resetar uma a uma.
--
-- Confira antes de rodar (deve dar 37):
--   SELECT COUNT(*) FROM `_user` WHERE `password` NOT LIKE '$2%';
--
-- O `id > 0` é sempre verdadeiro e não altera o conjunto afetado: existe só
-- para satisfazer o safe update mode do MySQL Workbench, que recusa UPDATE cujo
-- WHERE não use coluna indexada (erro 1175). Sem ele, é preciso rodar
-- `SET SQL_SAFE_UPDATES = 0` antes — mexer no filtro é mais simples do que
-- desligar a proteção.
UPDATE `_user`
   SET `must_change_password` = 1
 WHERE `id` > 0
   AND `password` NOT LIKE '$2%';


-- ─── 3. Tirar o DEFAULT '1234' da coluna de senha ─────────────────────────────
-- É a origem do problema: qualquer INSERT sem informar senha criava conta com
-- '1234' em texto puro. Sem default, o INSERT passa a falhar — que é o
-- comportamento correto, já que criar usuário sem senha não deveria ser
-- silencioso.
--
-- ⚠️ Se algum código faz INSERT em `_user` sem a coluna `password`, ele vai
-- quebrar. Verifique antes:
--   grep -rn "INSERT INTO \`_user\`" src/
ALTER TABLE `_user`
    ALTER COLUMN `password` DROP DEFAULT;


-- ─── Conferência ──────────────────────────────────────────────────────────────
-- SELECT
--     COUNT(*)                                                          AS total,
--     SUM(CASE WHEN must_change_password = 1 THEN 1 ELSE 0 END)         AS pendentes,
--     SUM(CASE WHEN password NOT LIKE '$2%' THEN 1 ELSE 0 END)          AS texto_puro
-- FROM `_user`;

-- Quem está pendente de troca:
-- SELECT id, user, name, ad_status, updated_at
--   FROM `_user` WHERE must_change_password = 1 ORDER BY updated_at;


-- ─── Rollback ─────────────────────────────────────────────────────────────────
-- ALTER TABLE `_user` ALTER COLUMN `password` SET DEFAULT '1234';
-- ALTER TABLE `_user` DROP COLUMN `must_change_password`;
