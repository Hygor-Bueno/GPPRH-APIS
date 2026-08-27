/**
 * Migração one-time: move BLOBs de foto de _employee → disco + _files, e
 * atualiza _user.file_id com o ID do registro gerado.
 *
 * Uso:
 *   node scripts/migrate-employee-photos.js [--dry-run] [--system-user=<id>]
 *
 * Flags:
 *   --dry-run       Processa tudo mas NÃO grava em disco nem no banco.
 *   --system-user   ID do usuário gravado em created_by_fk / updated_by_fk (padrão: 1).
 *
 * Pré-requisitos:
 *   - Coluna _user.file_id já existe (INT UNSIGNED NULL).
 *   - Variáveis de ambiente do banco disponíveis (.env).
 */

'use strict';

require('dotenv').config();

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const { poolGlobal } = require('../src/config/mysql');
const { detect }     = require('../src/utils/file/mime-detector');
const { MIME_TO_EXT } = require('../src/utils/file/constants');
const {
    sqlFindByHash,
    sqlInsertFile,
} = require('../src/modules/global/repositories/mysql/files.repository');

// ─── Config ───────────────────────────────────────────────────────────────────

const MODULE      = 'CCPP';
const STORAGE_ROOT = path.resolve(__dirname, '..');       // raiz do projeto (api/)
const args         = process.argv.slice(2);
const DRY_RUN      = args.includes('--dry-run');
const SYSTEM_USER  = (() => {
    const flag = args.find(a => a.startsWith('--system-user='));
    return flag ? parseInt(flag.split('=')[1], 10) : 1;
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function query(conn, sql, params = []) {
    const [rows] = await conn.execute(sql, params);
    return rows;
}

function buildPaths(hash, extension) {
    const now  = new Date();
    const yyyy = now.getFullYear();
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    const dd   = String(now.getDate()).padStart(2, '0');

    const subPath      = `storage/uploads/${MODULE}/${yyyy}/${mm}/${dd}`;
    const fileName     = `${hash}.${extension}`;
    const relativePath = `${subPath}/${fileName}`;
    const absoluteDir  = path.join(STORAGE_ROOT, subPath);
    const absolutePath = path.join(absoluteDir, fileName);

    return { relativePath, absolutePath, absoluteDir, fileName };
}

async function tryConvertToWebP(buf) {
    try {
        const sharp = require('sharp');
        return await sharp(buf).webp({ quality: 85 }).withMetadata(false).toBuffer();
    } catch {
        return null;
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('='.repeat(60));
    console.log('Migração: fotos de _employee → Storage/CCPP + _files + _user');
    if (DRY_RUN) console.log('*** MODO DRY-RUN: nada será gravado ***');
    console.log(`System user: ${SYSTEM_USER}`);
    console.log('='.repeat(60));

    const counters = { total: 0, success: 0, skipped: 0, duplicate: 0, error: 0 };

    let conn;
    try {
        conn = await poolGlobal.getConnection();

        const rows = await query(conn,
            `SELECT e.id AS employee_id, e.photo, u.id AS user_id
             FROM _employee e
             INNER JOIN _user u ON u.id = e.id
             WHERE e.photo IS NOT NULL
               AND u.file_id IS NULL`
        );

        counters.total = rows.length;
        console.log(`\nRegistros encontrados (sem file_id): ${rows.length}\n`);

        for (let i = 0; i < rows.length; i++) {
            const { employee_id, photo, user_id } = rows[i];
            const label = `[${i + 1}/${rows.length}] employee_id=${employee_id} user_id=${user_id}`;

            // Garante que o BLOB seja um Buffer
            const buf = Buffer.isBuffer(photo) ? photo : Buffer.from(photo);

            if (buf.length === 0) {
                console.log(`  SKIP  ${label} — buffer vazio`);
                counters.skipped++;
                continue;
            }

            // ── Detecção de MIME ────────────────────────────────────────────
            let mimeType;
            let finalBuf = buf;

            try {
                mimeType = detect(buf);
            } catch {
                console.log(`  SKIP  ${label} — MIME não reconhecido (primeiros bytes: ${buf.slice(0, 4).toString('hex')})`);
                counters.skipped++;
                continue;
            }

            if (!MIME_TO_EXT[mimeType]) {
                console.log(`  SKIP  ${label} — tipo não suportado: ${mimeType}`);
                counters.skipped++;
                continue;
            }

            // ── Conversão opcional para WebP (imagens PNG/JPEG) ─────────────
            if (mimeType === 'image/jpeg' || mimeType === 'image/png') {
                const webp = await tryConvertToWebP(buf);
                if (webp) {
                    finalBuf = webp;
                    mimeType = 'image/webp';
                }
            }

            const extension = MIME_TO_EXT[mimeType];

            // ── Hash + deduplicação ─────────────────────────────────────────
            const fileHash  = crypto.createHash('sha256').update(finalBuf).digest('hex');
            const existing  = await query(conn, sqlFindByHash(), [fileHash]);

            if (existing.length > 0) {
                const existingFileId = existing[0].id;
                console.log(`  DEDUP ${label} — file_id=${existingFileId} (hash já existe)`);

                if (!DRY_RUN) {
                    await query(conn,
                        `UPDATE _user SET file_id = ? WHERE id = ?`,
                        [existingFileId, user_id]
                    );
                }
                counters.duplicate++;
                continue;
            }

            // ── Caminhos de armazenamento ───────────────────────────────────
            const { relativePath, absolutePath, absoluteDir, fileName } =
                buildPaths(fileHash, extension);

            if (!DRY_RUN) {
                // ── Salva em disco ──────────────────────────────────────────
                fs.mkdirSync(absoluteDir, { recursive: true });
                fs.writeFileSync(absolutePath, finalBuf, { mode: 0o644 });

                // ── Insere em _files ────────────────────────────────────────
                let insertResult;
                try {
                    insertResult = await query(conn, sqlInsertFile(), [
                        relativePath,
                        fileName,
                        extension,
                        mimeType,
                        finalBuf.length,
                        fileHash,
                        SYSTEM_USER,
                        SYSTEM_USER,
                    ]);
                } catch (dbErr) {
                    try { fs.unlinkSync(absolutePath); } catch { /* ignora */ }
                    console.error(`  ERROR ${label} — falha ao inserir _files: ${dbErr.message}`);
                    counters.error++;
                    continue;
                }

                const fileId = insertResult.insertId;

                // ── Atualiza _user.file_id ──────────────────────────────────
                await query(conn,
                    `UPDATE _user SET file_id = ? WHERE id = ?`,
                    [fileId, user_id]
                );

                console.log(`  OK    ${label} — file_id=${fileId} ${mimeType} ${(finalBuf.length / 1024).toFixed(1)} KB`);
            } else {
                console.log(`  DRY   ${label} — ${mimeType} ${(finalBuf.length / 1024).toFixed(1)} KB → ${relativePath}`);
            }

            counters.success++;
        }
    } finally {
        if (conn) conn.release();
        await poolGlobal.end();
    }

    // ── Relatório final ───────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('RELATÓRIO FINAL');
    console.log('='.repeat(60));
    console.log(`  Total encontrado : ${counters.total}`);
    console.log(`  Sucesso          : ${counters.success}`);
    console.log(`  Duplicatas       : ${counters.duplicate}`);
    console.log(`  Ignorados (skip) : ${counters.skipped}`);
    console.log(`  Erros            : ${counters.error}`);
    console.log('='.repeat(60));

    if (counters.error > 0) process.exit(1);
}

main().catch(err => {
    console.error('\nErro fatal:', err.message);
    process.exit(1);
});
