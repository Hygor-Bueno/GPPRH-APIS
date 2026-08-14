/**
 * @fileoverview Porta (contrato) de replicação de pagamentos no MySQL GIPP
 * (banco separado do SQL Server, via `poolGippMySQL`).
 * @module modules/gipp/application/ports/gipp-replication-repository.port
 */

class GippReplicationRepositoryPort {
    /**
     * Replica um registro de pagamento via `sp_insert_recibo_pagamento_por_cpf`.
     * @param {object} payment
     */
    replicatePayment(payment) { throw new Error('Not implemented'); }
}

module.exports = { GippReplicationRepositoryPort };
