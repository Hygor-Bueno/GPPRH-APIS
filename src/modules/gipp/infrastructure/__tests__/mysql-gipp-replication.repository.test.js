/**
 * @fileoverview A distinção que este teste protege é a que torna seguro pular
 * uma pessoa: "CPF não encontrado" pode ser pulado, MySQL fora do ar não.
 * Se `isEmployeeNotFound` passar a reconhecer erro de infraestrutura, o lote
 * seguiria gerando recibo sem contrapartida no MySQL, em silêncio.
 */

const mockGetConnection = jest.fn();

jest.mock('../../../../config/mysql', () => ({
    poolGippMySQL: { getConnection: () => mockGetConnection() },
}));

const { MysqlGippReplicationRepository } = require('../mysql-gipp-replication.repository');
const { AppError } = require('../../../../errors/app.error');

const PAGAMENTO = {
    cpf: '37077125831',
    data: '24/08/2026',
    descricao: 'Serviços Prestados',
    referencia: '1d',
    proventos: 173,
    total_proventos: 253.21,
};

function conexaoQueFalhaCom(erro) {
    const release = jest.fn();
    mockGetConnection.mockResolvedValue({
        execute: jest.fn().mockRejectedValue(erro),
        release,
    });
    return { release };
}

describe('MysqlGippReplicationRepository', () => {
    beforeEach(() => jest.clearAllMocks());

    it('should map the procedure SIGNAL to MYSQL_EMPLOYEE_NOT_FOUND', async () => {
        // Como o driver entrega o SIGNAL SQLSTATE '45000' da procedure.
        conexaoQueFalhaCom(Object.assign(new Error('CPF não encontrado.'), {
            sqlState: '45000',
            errno: 1644,
            sqlMessage: 'CPF não encontrado.',
        }));

        const repo = new MysqlGippReplicationRepository();

        await expect(repo.replicatePayment(PAGAMENTO)).rejects.toMatchObject({
            statusCode: 422,
            code: 'MYSQL_EMPLOYEE_NOT_FOUND',
        });
    });

    it('should treat infrastructure failures as MYSQL_GIPP_ERROR so the batch aborts', async () => {
        for (const erro of [
            Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }),
            Object.assign(new Error('Deadlock found'), { sqlState: '40001', errno: 1213 }),
            Object.assign(new Error('Too many connections'), { sqlState: '08004', errno: 1040 }),
            // Mesmo SQLSTATE de SIGNAL, mas outra mensagem: 45000 é genérico e
            // outra procedure pode usá-lo para outra coisa.
            Object.assign(new Error('Valor invalido.'), { sqlState: '45000', sqlMessage: 'Valor invalido.' }),
        ]) {
            conexaoQueFalhaCom(erro);
            const repo = new MysqlGippReplicationRepository();

            await expect(repo.replicatePayment(PAGAMENTO)).rejects.toMatchObject({
                statusCode: 500,
                code: 'MYSQL_GIPP_ERROR',
            });
        }
    });

    it('should preserve the original error in details', async () => {
        const original = Object.assign(new Error('CPF não encontrado.'), {
            sqlState: '45000',
            sqlMessage: 'CPF não encontrado.',
        });
        conexaoQueFalhaCom(original);

        const repo = new MysqlGippReplicationRepository();
        const erro = await repo.replicatePayment(PAGAMENTO).catch(e => e);

        expect(erro).toBeInstanceOf(AppError);
        expect(erro.details).toBe(original);
    });

    it('should release the connection even when the call fails', async () => {
        const { release } = conexaoQueFalhaCom(new Error('qualquer falha'));
        const repo = new MysqlGippReplicationRepository();

        await repo.replicatePayment(PAGAMENTO).catch(() => {});

        expect(release).toHaveBeenCalledTimes(1);
    });
});
