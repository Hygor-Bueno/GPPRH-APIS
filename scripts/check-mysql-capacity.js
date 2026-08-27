/**
 * Diagnóstico de capacidade do MySQL — encontra empiricamente o teto de
 * conexões concorrentes que o servidor aguenta, sem precisar de acesso
 * administrativo (SHOW VARIABLES/PROCESSLIST não é necessário).
 *
 * Sobe em rampa (não manda tudo de uma vez): testa um patamar, fecha tudo,
 * espera um pouco, sobe pro próximo. Para no primeiro patamar que falhar e
 * reporta o último patamar 100% bem-sucedido como teto seguro. Tem um limite
 * máximo de segurança (--max) pra nunca tentar um número absurdo de conexões.
 *
 * Uso:
 *   node scripts/check-mysql-capacity.js --target=global --start=20 --step=20 --max=300
 *   node scripts/check-mysql-capacity.js --target=gpprh
 *   node scripts/check-mysql-capacity.js --target=gipp
 *
 * Flags:
 *   --target   'gpprh' (MYSQL_*), 'global' (MYSQL_GLOBAL_*) ou 'gipp' (MYSQL_GIPP_*). Padrão: global.
 *   --start    Patamar inicial de conexões concorrentes. Padrão: 20.
 *   --step     Incremento a cada rodada. Padrão: 20.
 *   --max      Teto de segurança — nunca testa acima disso. Padrão: 300.
 *   --delay    Pausa em ms entre rodadas, pro servidor "respirar". Padrão: 500.
 *
 * Pré-requisitos:
 *   - Rodar do servidor onde a API roda (rede até o MySQL).
 *   - Variáveis de ambiente do banco disponíveis (.env).
 */

'use strict';

require('dotenv').config();

const mysql = require('mysql2/promise');

const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    acc[key] = value ?? true;
    return acc;
}, {});

const target = args.target || 'global';
const start = parseInt(args.start || '20', 10);
const step = parseInt(args.step || '20', 10);
const max = parseInt(args.max || '300', 10);
const delayMs = parseInt(args.delay || '500', 10);

const envPrefix = { gpprh: 'MYSQL', global: 'MYSQL_GLOBAL', gipp: 'MYSQL_GIPP' };
const prefix = envPrefix[target];
if (!prefix) {
    console.error(`--target inválido: "${target}". Use "gpprh", "global" ou "gipp".`);
    process.exit(1);
}

const config = {
    host: process.env[`${prefix}_HOST`],
    user: process.env[`${prefix}_USER`],
    password: process.env[`${prefix}_PASSWORD`],
    database: process.env[`${prefix}_DATABASE`],
    port: Number(process.env[`${prefix}_PORT`] || 3306),
    connectTimeout: 10000,
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testLevel(n) {
    const started = Date.now();
    const results = await Promise.allSettled(
        Array.from({ length: n }, () =>
            mysql.createConnection(config).then(async (conn) => {
                await conn.query('SELECT 1');
                await conn.end();
            })
        )
    );
    const elapsedMs = Date.now() - started;
    const failed = results.filter((r) => r.status === 'rejected');
    return { n, elapsedMs, ok: n - failed.length, failed };
}

async function main() {
    console.log(`Rampa de conexões MySQL em ${target} (${config.host}:${config.port}/${config.database})`);
    console.log(`Início: ${start}, incremento: ${step}, teto de segurança: ${max}\n`);

    let lastGood = 0;

    for (let n = start; n <= max; n += step) {
        process.stdout.write(`Testando ${n} conexões concorrentes... `);
        const result = await testLevel(n);

        if (result.failed.length === 0) {
            console.log(`OK (${result.elapsedMs}ms)`);
            lastGood = n;
        } else {
            console.log(`FALHOU — ${result.failed.length}/${n} conexões com erro`);
            const sample = result.failed[0].reason;
            console.log(`Exemplo de erro: ${sample.code || sample.message}`);
            break;
        }

        await sleep(delayMs);
    }

    console.log(`\nTeto seguro encontrado: ${lastGood} conexões concorrentes (sem falhas).`);
    if (lastGood === max) {
        console.log(`Atingiu o teto de segurança do teste (--max=${max}) sem falhar — o servidor aguenta pelo menos isso.`);
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('Falha ao conectar:', err.message);
    process.exit(1);
});
