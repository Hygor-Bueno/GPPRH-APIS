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
            throw new AppError(error.message || 'Error replicating payment to MySQL', 500, 'MYSQL_GIPP_ERROR', error);
        } finally {
            conn.release();
        }
    }
}

module.exports = { MysqlGippReplicationRepository };
