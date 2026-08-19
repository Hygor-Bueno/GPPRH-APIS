/**
 * @fileoverview Adapter MySQL GIPP — implementa `GippReplicationRepositoryPort`.
 * Usa `poolGippMySQL`, um pool MySQL separado do `poolGlobal`, dedicado à
 * replicação de pagamentos calculados no SQL Server.
 * @module modules/gipp/infrastructure/mysql-gipp-replication.repository
 */

const { poolGippMySQL } = require('../../../config/mysql');
const { AppError } = require('../../../errors/app.error');
const { GippReplicationRepositoryPort } = require('../application/ports/gipp-replication-repository.port');

class MysqlGippReplicationRepository extends GippReplicationRepositoryPort {
    async replicatePayment(payment) {
        const conn = await poolGippMySQL.getConnection();
        try {
            await conn.execute(
                `CALL sp_insert_recibo_pagamento_por_cpf(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    payment.cpf,
                    payment.data,
                    payment.descricao,
                    payment.referencia,
                    payment.proventos,
                    payment.descricao2,
                    payment.referencia2,
                    payment.proventos2,
                    payment.descricao3,
                    payment.referencia3,
                    payment.proventos3,
                    payment.total_proventos,
                ]
            );
        } catch (error) {
            // O terceiro parâmetro de AppError é um OBJETO { code, details }.
            // Passar string aqui fazia `options.code` ficar undefined, o code cair
            // para 'GENERIC_ERROR' e o erro original ser descartado inteiro.
            throw new AppError('Não foi possível replicar o pagamento no MySQL.', 500, {
                code: 'MYSQL_GIPP_ERROR',
                details: error,
            });
        } finally {
            conn.release();
        }
    }
}

module.exports = { MysqlGippReplicationRepository };
