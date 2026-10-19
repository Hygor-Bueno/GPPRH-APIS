/**
 * @fileoverview Adapter MySQL (`poolGlobal`) — implementa `BirthdayFlyerArtRepositoryPort`.
 * @module modules/global/infrastructure/gipp-rh/mysql-birthday-flyer-art.repository
 */

const { poolGlobal } = require('../../../../config/mysql');
const { AppError } = require('../../../../errors/app.error');
const { BirthdayFlyerArtRepositoryPort } = require('../../application/gipp-rh/birthday/ports/birthday-flyer-art-repository.port');
const { FlyerArtErrorCode } = require('../../domain/gipp-rh/birthday-flyer-art.rules');
const {
    SQL_LIST_FLYER_ARTS,
    SQL_FIND_FLYER_ART,
    SQL_UPSERT_FLYER_ART,
    SQL_DELETE_FLYER_ART,
} = require('../../repositories/mysql/birthday-flyer-art.queries');

async function query(sql, params, message) {
    try {
        const [result] = await poolGlobal.execute(sql, params);
        return result;
    } catch (error) {
        throw new AppError(message, 500, { code: FlyerArtErrorCode.MysqlError, details: error });
    }
}

/** O driver devolve a coluna JSON já como objeto; a string fica como rede. */
function shape(row) {
    if (!row) return null;
    return {
        company_code: row.company_code,
        file_id: Number(row.file_id),
        image_width: Number(row.image_width),
        image_height: Number(row.image_height),
        layout: typeof row.layout === 'string' ? JSON.parse(row.layout) : row.layout,
        updated_at: row.updated_at,
        updated_by: Number(row.updated_by),
    };
}

class MySqlBirthdayFlyerArtRepository extends BirthdayFlyerArtRepositoryPort {
    async list() {
        const rows = await query(SQL_LIST_FLYER_ARTS, [], 'Erro ao ler as artes do cartaz.');
        return rows.map(shape);
    }

    async findByCompany(companyCode) {
        const rows = await query(SQL_FIND_FLYER_ART, [companyCode], 'Erro ao ler a arte do cartaz.');
        return shape(rows[0]);
    }

    async upsert({ companyCode, fileId, imageWidth, imageHeight, layout, userId }) {
        await query(
            SQL_UPSERT_FLYER_ART,
            [companyCode, fileId, imageWidth, imageHeight, JSON.stringify(layout), userId],
            'Erro ao gravar a arte do cartaz.',
        );
    }

    async remove(companyCode) {
        const result = await query(SQL_DELETE_FLYER_ART, [companyCode], 'Erro ao remover a arte do cartaz.');
        return result.affectedRows > 0;
    }
}

module.exports = { MySqlBirthdayFlyerArtRepository };
