/**
 * @fileoverview Lista de exclusão do cartaz de aniversariantes — `rh_birthday_exclusions`
 * (MySQL `global`).
 *
 * A tabela guarda só CPF, motivo e quem tirou. Nome, filial e setor saem do
 * Protheus na hora (`SqlServerBirthdayRepository.findCurrentContractsByCpf`).
 *
 * @module modules/global/repositories/mysql/birthday-exclusion.queries
 */

const SQL_LIST_EXCLUDED_CPFS = `
    SELECT cpf
      FROM rh_birthday_exclusions`;

const SQL_LIST_EXCLUSIONS = `
    SELECT id, cpf, reason, created_at, created_by
      FROM rh_birthday_exclusions
     ORDER BY created_at DESC, id DESC`;

const SQL_INSERT_EXCLUSION = `
    INSERT INTO rh_birthday_exclusions (cpf, reason, created_by)
    VALUES (?, ?, ?)`;

const SQL_DELETE_EXCLUSION = `
    DELETE FROM rh_birthday_exclusions
     WHERE id = ?`;

module.exports = {
    SQL_LIST_EXCLUDED_CPFS,
    SQL_LIST_EXCLUSIONS,
    SQL_INSERT_EXCLUSION,
    SQL_DELETE_EXCLUSION,
};
