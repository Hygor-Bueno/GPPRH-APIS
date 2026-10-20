/**
 * @fileoverview Artes do cartaz de aniversariantes por empresa — `rh_birthday_flyer_arts`
 * (MySQL `global`). A imagem fica no `_files`; aqui vão a referência e as medidas.
 *
 * @module modules/global/repositories/mysql/birthday-flyer-art.queries
 */

const ART_COLUMNS = 'company_code, file_id, image_width, image_height, layout, updated_at, updated_by';

const SQL_LIST_FLYER_ARTS = `
    SELECT ${ART_COLUMNS}
      FROM rh_birthday_flyer_arts
     ORDER BY company_code`;

const SQL_FIND_FLYER_ART = `
    SELECT ${ART_COLUMNS}
      FROM rh_birthday_flyer_arts
     WHERE company_code = ?`;

/** Uma arte por empresa: enviar de novo substitui. */
const SQL_UPSERT_FLYER_ART = `
    INSERT INTO rh_birthday_flyer_arts
           (company_code, file_id, image_width, image_height, layout, updated_by)
    VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)
        AS novo
    ON DUPLICATE KEY UPDATE
           file_id      = novo.file_id,
           image_width  = novo.image_width,
           image_height = novo.image_height,
           layout       = novo.layout,
           updated_by   = novo.updated_by`;

const SQL_DELETE_FLYER_ART = `
    DELETE FROM rh_birthday_flyer_arts
     WHERE company_code = ?`;

module.exports = {
    SQL_LIST_FLYER_ARTS,
    SQL_FIND_FLYER_ART,
    SQL_UPSERT_FLYER_ART,
    SQL_DELETE_FLYER_ART,
};
