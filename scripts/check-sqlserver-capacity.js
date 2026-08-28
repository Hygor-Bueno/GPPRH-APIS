/**
 * Diagnóstico de capacidade do SQL Server (Protheus e/ou GIPP) — NÃO altera nada.
 *
 * Abre N conexões reais e concorrentes (fora do pool da aplicação, numa pool
 * própria e descartável) pra responder empiricamente: "dá pra sustentar N
 * conexões simultâneas nesse servidor sem erro de recusa/timeout?" — em vez
 * de só olhar configuração teórica.
 *
 * Uso:
 *   node scripts/check-sqlserver-capacity.js --target=protheus --n=40
 *   node scripts/check-sqlserver-capacity.js --target=gipp --n=40
 *
 * Flags:
 *   --target   'protheus' (usa PROTHEUS_DB_*) ou 'gipp' (usa GIPP_SQLSERVER_DB_*). Padrão: protheus.
 *   --n        Quantidade de conexões concorrentes a testar. Padrão: 40.
 *
 * Pré-requisitos:
 *   - Rodar de uma máquina com rede até o SQL Server (não funciona do sandbox
 *     de edição — só do host onde a API/PM2 realmente roda).
 *   - Variáveis de ambiente do banco disponíveis (.env).
 */

'use strict';

require('dotenv').config();

const sql = require('mssql');

const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    acc[key] = value ?? true;
    return acc;
}, {});

const target = args.target || 'protheus';
const n = parseInt(args.n || '40', 10);

const configs = {
    protheus: {
        user: process.env.PROTHEUS_DB_USER,
        password: process.env.PROTHEUS_DB_PASSWORD,
        server: process.env.PROTHEUS_DB_SERVER,
        database: process.env.PROTHEUS_DB_DATABASE,
        port: parseInt(process.env.PROTHEUS_DB_PORT || '1433', 10),
        options: { encrypt: process.env.PROTHEUS_DB_OPTIONS_ENCRYPT === 'true', enableArithAbort: true },
    },
    gipp: {
        user: process.env.GIPP_SQLSERVER_DB_USER,
        password: process.env.GIPP_SQLSERVER_DB_PASSWORD,
        server: process.env.GIPP_SQLSERVER_DB_SERVER,
        database: process.env.GIPP_SQLSERVER_DB_DATABASE,
        port: parseInt(process.env.GIPP_SQLSERVER_DB_PORT || '1433', 10),
        options: { encrypt: process.env.GIPP_SQLSERVER_DB_OPTIONS_ENCRYPT === 'true', enableArithAbort: true },
    },
};

const baseConfig = configs[target];
if (!baseConfig) {
    console.error(`--target inválido: "${target}". Use "protheus" ou "gipp".`);
    process.exit(1);
}

async function main() {
    console.log(`Testando ${n} conexões concorrentes em ${target} (${baseConfig.server}:${baseConfig.port}/${baseConfig.database})...\n`);

    const pool = new sql.ConnectionPool({
        ...baseConfig,
        pool: { max: n, min: 0, idleTimeoutMillis: 30000, acquireTimeoutMillis: 15000 },
        requestTimeout: 15000,
    });

    await pool.connect();

    const started = Date.now();
    const results = await Promise.allSettled(
        Array.from({ length: n }, (_, i) =>
            pool.request().query('SELECT 1 AS ok').then(() => i)
        )
    );
    const elapsedMs = Date.now() - started;

    const ok = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');

    console.log(`Sucesso: ${ok}/${n} conexões em ${elapsedMs}ms`);
    if (failed.length) {
        console.log(`Falharam: ${failed.length}`);
        const sample = failed[0].reason;
        console.log(`Exemplo de erro: ${sample.code || sample.message}`);
    } else {
        console.log('Todas as conexões concorrentes foram atendidas sem erro.');
    }

    await pool.close();
    process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
    console.error('Falha ao conectar:', err.message);
    process.exit(1);
});
