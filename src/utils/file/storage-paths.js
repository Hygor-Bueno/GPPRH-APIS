/**
 * @fileoverview Onde mora, no disco, o arquivo de um registro de `_files`.
 *
 * `_files.file_path` é sempre RELATIVO (`storage/uploads/{MODULO}/AAAA/MM/DD/<hash>.<ext>`)
 * e nunca muda. O que muda é a raiz: por padrão, a raiz do projeto; para módulos
 * com raiz externa configurada, outro disco. Hoje só o MIEPP tem raiz externa, a
 * pasta de rede do marketing (`\\10.10.10.35\midias_marketing$`), montada no host
 * em `/mnt/midias_marketing` e no container em `MIEPP_STORAGE_ROOT`.
 *
 * Por que o banco não muda: o caminho relativo continua o mesmo, então apontar o
 * MIEPP de volta para o disco local é só remover a variável. Nenhum UPDATE em
 * `_files`, nenhuma migração a desfazer.
 *
 * Na raiz externa o prefixo `storage/uploads/` cai: o arquivo fica em
 * `<raiz>/MIEPP/AAAA/MM/DD/<hash>.<ext>`, que é o que o marketing vê no Explorer.
 *
 * Sem dependência de banco nem de outro serviço: o `video-transcoder` roda em
 * outro container e usa este mesmo arquivo, para que os dois nunca discordem
 * sobre onde um vídeo está.
 *
 * @module utils/file/storage-paths
 */

const fs = require('fs');
const path = require('path');

const { AppError } = require('../../errors/app.error');

/**
 * Raiz do projeto: `__dirname` = `.../api/src/utils/file`, `../../..` = `.../api/`.
 * @constant {string}
 */
const STORAGE_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Prefixo de todo `file_path` gravado pelo FileService do Node. */
const UPLOADS_PREFIX = 'storage/uploads/';

/** Módulo → variável de ambiente com a raiz externa dele. */
const EXTERNAL_ROOT_ENV = Object.freeze({
    MIEPP: 'MIEPP_STORAGE_ROOT',
});

/**
 * Arquivo que precisa existir na raiz externa para ela ser considerada montada.
 *
 * Existe por causa do modo de falha mais perigoso: se a pasta de rede não subir
 * (o `fstab` usa `nofail`, então o boot segue sem ela), o ponto de montagem
 * continua lá, VAZIO e gravável, no disco local. Sem esta checagem os uploads
 * cairiam nele em silêncio e sumiriam da vista assim que a rede voltasse a
 * montar por cima. Com ela, o upload falha com 503 e alguém fica sabendo.
 */
const MOUNT_MARKER = '.gipp-storage';

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Object<string, string>} módulo → raiz absoluta, só os configurados.
 */
function readExternalRoots(env = process.env) {
    const roots = {};
    for (const [module, variable] of Object.entries(EXTERNAL_ROOT_ENV)) {
        const value = env[variable];
        if (value && value.trim()) roots[module] = path.resolve(value.trim());
    }
    return roots;
}

/** Lidas uma vez: mudar a raiz exige reiniciar o processo, como qualquer env. */
const EXTERNAL_ROOTS = readExternalRoots();

/**
 * Módulo de um `file_path`, ou `null` se ele não segue o padrão do FileService
 * (ex.: registros antigos do PHP, `Storage/GTPP/uploads/...`).
 *
 * @param {string} relativePath
 * @returns {string|null}
 */
function moduleOf(relativePath) {
    const normalized = String(relativePath).split('\\').join('/');
    if (!normalized.startsWith(UPLOADS_PREFIX)) return null;
    return normalized.slice(UPLOADS_PREFIX.length).split('/')[0] || null;
}

/**
 * Caminho absoluto de um `file_path` relativo.
 *
 * Vale para o arquivo e para tudo que mora ao lado dele com o mesmo prefixo — a
 * capa do vídeo (`poster_path`) e a saída do transcodificador seguem o vídeo
 * para a raiz externa sem regra própria.
 *
 * @param {string} relativePath
 * @param {Object<string, string>} [roots]
 * @returns {string}
 */
function resolveStoragePath(relativePath, roots = EXTERNAL_ROOTS) {
    const normalized = String(relativePath).split('\\').join('/');
    const root = roots[moduleOf(normalized)];

    if (root) {
        return path.join(root, normalized.slice(UPLOADS_PREFIX.length));
    }
    return path.join(STORAGE_ROOT, normalized);
}

/**
 * Recusa gravar numa raiz externa que não está montada.
 *
 * Só olha módulos com raiz externa; os demais passam direto. O `existsSync` é
 * por gravação e custa um `stat` — barato perto do upload que ele protege.
 *
 * @param {string} module
 * @param {Object<string, string>} [roots]
 * @throws {AppError} 503 quando o marcador não existe.
 */
function assertStorageReady(module, roots = EXTERNAL_ROOTS) {
    const root = roots[module];
    if (!root) return;

    if (!fs.existsSync(path.join(root, MOUNT_MARKER))) {
        throw new AppError(
            `Armazenamento do módulo ${module} indisponível (pasta de rede não montada). Tente novamente mais tarde.`,
            503,
            { code: 'STORAGE_UNAVAILABLE' }
        );
    }
}

module.exports = {
    STORAGE_ROOT,
    UPLOADS_PREFIX,
    EXTERNAL_ROOT_ENV,
    EXTERNAL_ROOTS,
    MOUNT_MARKER,
    readExternalRoots,
    moduleOf,
    resolveStoragePath,
    assertStorageReady,
};
