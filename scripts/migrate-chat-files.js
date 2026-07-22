// scripts/migrate-chat-files.js
// node scripts/migrate-chat-files.js

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { poolGlobal } = require('../src/config/mysql');

const OLD_UPLOADS_DIR = path.resolve(__dirname, '../storage/uploads/CLPP/legacy');
const SYSTEM_USER_ID  = 148; // ← troque pelo ID do seu usuário administrador

const MIME_MAP = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png',  webp: 'image/webp',
    gif: 'image/gif',  pdf:  'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

async function run() {
    const conn = await poolGlobal.getConnection();

    try {
        const files = fs.readdirSync(OLD_UPLOADS_DIR).filter(f => !f.startsWith('.'));
        console.log(`${files.length} arquivos encontrados.`);

        let ok = 0, skip = 0, fail = 0;

        for (const filename of files) {
            const match = filename.match(/^(\d+)_(\d+)_(\d+)\.(\w+)$/);
            if (!match) {
                console.warn(`  [SKIP] nome fora do padrão: ${filename}`);
                skip++;
                continue;
            }

            const messageId = parseInt(match[3], 10);
            const ext       = match[4].toLowerCase();
            const mime      = MIME_MAP[ext] ?? 'application/octet-stream';

            try {
                const [msgs] = await conn.execute(
                    'SELECT id, date AS created_at FROM global.cl_message WHERE id = ? AND file_id IS NULL',
                    [messageId]
                );

                if (msgs.length === 0) {
                    console.warn(`  [SKIP] msg ${messageId} não encontrada ou já migrada (${filename})`);
                    skip++;
                    continue;
                }

                const msgDate = new Date(msgs[0].created_at);
                const yyyy    = msgDate.getFullYear();
                const mm      = String(msgDate.getMonth() + 1).padStart(2, '0');
                const dd      = String(msgDate.getDate()).padStart(2, '0');

                const buf  = fs.readFileSync(path.join(OLD_UPLOADS_DIR, filename));
                const hash = crypto.createHash('sha256').update(buf).digest('hex');

                const relPath = `storage/uploads/CLPP/${yyyy}/${mm}/${dd}/${hash}.${ext}`;
                const absPath = path.resolve(__dirname, '..', relPath);

                if (!fs.existsSync(absPath)) {
                    fs.mkdirSync(path.dirname(absPath), { recursive: true });
                    fs.copyFileSync(path.join(OLD_UPLOADS_DIR, filename), absPath);
                }

                const [existing] = await conn.execute(
                    'SELECT id FROM global._files WHERE file_hash = ? LIMIT 1',
                    [hash]
                );

                let fileId;
                if (existing.length > 0) {
                    fileId = existing[0].id;
                } else {
                    const [ins] = await conn.execute(`
                        INSERT INTO global._files
                            (file_path, file_name, file_extension, file_type, file_size, file_hash, status, created_by_fk, updated_by_fk, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NOW(), NOW())
                    `, [relPath, filename, ext, mime, buf.length, hash, SYSTEM_USER_ID, SYSTEM_USER_ID]);

                    fileId = ins.insertId;
                }

                await conn.execute(
                    'UPDATE global.cl_message SET file_id = ? WHERE id = ?',
                    [fileId, messageId]
                );

                console.log(`  [OK] msg ${messageId} → file_id ${fileId} (${filename})`);
                ok++;

            } catch (err) {
                console.error(`  [ERRO] ${filename}:`, err.message);
                fail++;
            }
        }

        console.log(`\nMigração concluída: ${ok} OK | ${skip} ignorados | ${fail} erros`);

        const [[{ pendentes }]] = await conn.execute(
            'SELECT COUNT(*) AS pendentes FROM global.cl_message WHERE type IN (2,3) AND file_id IS NULL'
        );
        console.log(`Mensagens de arquivo ainda sem file_id: ${pendentes}`);

    } finally {
        conn.release();
        process.exit(0);
    }
}

run().catch(err => {
    console.error('Falha fatal:', err);
    process.exit(1);
});

