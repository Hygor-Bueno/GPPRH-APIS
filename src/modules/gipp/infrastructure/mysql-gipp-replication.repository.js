/**
 * @fileoverview Adapter MySQL GIPP — implementa `GippReplicationRepositoryPort`.
 * Usa `poolGippMySQL`, um pool MySQL separado do `poolGlobal`, dedicado à
 * replicação de pagamentos calculados no SQL Server.
 * @module modules/gipp/infrastructure/mysql-gipp-replication.repository
 */

const { poolGippMySQL } = require('../../../config/mysql');
const { AppError } = require('../../../errors/app.error');
const { GippReplicationRepositoryPort } = require('../application/ports/gipp-replication-repository.port');

/**
 * O colaborador não existe no cadastro do MySQL?
 *
 * `sp_insert_recibo_pagamento_por_cpf` faz `SIGNAL SQLSTATE '45000'` com
 * "CPF não encontrado." quando o CPF não casa em rh_dados/rh_documentos/
 * rh_contratos com contrato Ativo. O driver entrega isso como sqlState '45000'
 * (errno 1644); a mensagem entra como segundo critério porque `45000` é o estado
 * genérico de SIGNAL e outra procedure poderia usá-lo para outra coisa.
 */
function isEmployeeNotFound(error) {
    return error?.sqlState === '45000'
        && /CPF\s+n[ãa]o\s+encontrado/i.test(String(error?.sqlMessage ?? error?.message ?? ''));
}

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
            // Cadastro faltando é problema de dado, não de infraestrutura, e
            // ganha código próprio porque quem chama trata os dois de forma
            // oposta: este pode ser pulado (uma pessoa não bloqueia o lote),
            // enquanto MySQL fora do ar precisa abortar — senão o recibo sairia
            // sem contrapartida e ninguém ficaria sabendo.
            if (isEmployeeNotFound(error)) {
                throw new AppError(
                    'Colaborador não encontrado no cadastro do MySQL (CPF sem contrato ativo).',
                    422,
                    { code: 'MYSQL_EMPLOYEE_NOT_FOUND', details: error },
                );
            }

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
