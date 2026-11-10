/**
 * @fileoverview Casos de uso da migração TEMPORÁRIA de termos de smartphone do
 * sistema legado para `gapp_asset_term`.
 *
 * Fluxo (cada passo é uma ação da tela e pode ser repetido sem efeito colateral):
 *
 *   scan      pasta de origem → uma linha `pending` por arquivo novo
 *             (nome inválido já nasce `error/INVALID_NAME`)
 *   validate  nome → `GIPP.gs_smartphone.codigo` → IMEI (imei1, depois imei2)
 *             → `gapp_smartphone` da base nova → `validated` com o ativo, ou
 *             `not_found` / `error` com o motivo
 *   migrate   só `validated`, em lote pequeno: lê o arquivo, cria o termo pelo
 *             MESMO caso de uso do POST /gapp/asset-term (FileService: validação,
 *             hash, dedup, `_files`; depois `gapp_asset_term`) → `migrated`
 *   retry     `error` / `not_found` / `processing` abandonado → `pending` e valida de novo
 *
 * Garantias contra duplicidade:
 *   - a varredura é idempotente (chave única no caminho de origem);
 *   - toda transição é condicionada ao status anterior — com 2 instâncias da API
 *     (cluster), só quem "ganha" a linha a processa;
 *   - antes de criar o termo procura um vínculo já existente deste documento com
 *     este ativo (hash do conteúdo ou nome do arquivo). Cobre o lote que caiu
 *     depois de criar o termo e antes de marcar `migrated`;
 *   - o FileService deduplica o conteúdo por SHA-256 — o mesmo arquivo nunca é
 *     gravado duas vezes em `_files`.
 *
 * Atomicidade: o FileService grava em conexão própria (não participa de
 * transação de fora), então o par "documento + vínculo" segue a mesma regra do
 * cadastro de termos de sempre — arquivo primeiro, vínculo depois. Se o vínculo
 * falhar, sobra no máximo um `_files` sem referência (deduplicado no próximo
 * envio); nunca existe vínculo apontando para arquivo inexistente.
 *
 * O código antigo NUNCA vira id de ativo: o vínculo sai sempre do IMEI.
 *
 * @module modules/global/application/gapp/term-migration/gapp-term-migration.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const {
    MIGRATION_STATUS: S, ALL_STATUSES, ISSUE, ISSUE_STATUS, VALIDATABLE_STATUSES,
    parseLegacyFileName, legacyImeiCandidates, resolveAssetMatch,
    normalizeIdList, normalizeBatchSize, clipMessage,
} = require('../../../domain/gapp/term-migration/term-migration.rules');
const { normalizePagination, paginated } = require('../../../domain/shared/pagination.rules');

/** Lotes: validação é só leitura (pode ser maior); migração grava arquivo (pequeno). */
const VALIDATE_BATCH = { fallback: 200, max: 1000 };
const MIGRATE_BATCH = { fallback: 10, max: 50 };
const RETRY_BATCH = { fallback: 200, max: 1000 };

/** `gapp_asset_term_migration.source_path` é VARCHAR(500). */
const SOURCE_PATH_MAX = 500;

/** Falha de infraestrutura: para o lote inteiro em vez de marcar erro em cada arquivo. */
const isInfrastructureOutage = error => Number(error?.statusCode) === 503;

class GappTermMigrationUseCases {
    /**
     * @param {{
     *   repository: import('./ports/term-migration.ports').TermMigrationRepositoryPort,
     *   source: import('./ports/term-migration.ports').TermMigrationSourcePort,
     *   termCreator: { createAssetTerm(data: object, file: object, userId: number): Promise<object> },
     * }} deps
     */
    constructor({ repository, source, termCreator }) {
        this.repository = repository;
        this.source = source;
        this.termCreator = termCreator;
    }

    // ── Painel ───────────────────────────────────────────────────────────────

    async summary() {
        const { byStatus, byIssue } = await this.repository.summary();
        const counts = Object.fromEntries(ALL_STATUSES.map(status => [status, 0]));
        byStatus.forEach(row => { counts[row.status] = Number(row.total) || 0; });
        const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

        return {
            total,
            counts,
            issues: Object.fromEntries(byIssue.map(row => [row.issue_code, Number(row.total) || 0])),
            source: this.source.describe(),
        };
    }

    async list(query = {}) {
        const pagination = normalizePagination(query);
        const filters = {
            status: query.status || null,
            issue_code: query.issue_code || null,
            active_id_fk: query.active_id_fk ? Number(query.active_id_fk) : null,
            search: query.search || null,
        };
        const { rows, total } = await this.repository.list(filters, pagination);
        return paginated(rows, total, pagination);
    }

    async getById(id) {
        const item = await this.repository.findById(Number(id));
        if (!item) throw new AppError('Registro de migração não encontrado.', 404, { code: 'TERM_MIGRATION_NOT_FOUND' });
        const logs = await this.repository.listLogs(item.migration_id);
        return { ...item, logs };
    }

    // ── 1. Identificação dos arquivos ────────────────────────────────────────

    async scan(userId) {
        const files = await this.source.list();
        const known = await this.repository.findKnownPaths(files.map(f => f.relativePath));
        const fresh = files.filter(f => !known.has(f.relativePath));

        // Caminho maior que a coluna não entra: truncado, deixaria de achar o arquivo
        // (e dois caminhos longos poderiam colidir na chave única).
        const failed = fresh
            .filter(f => f.relativePath.length > SOURCE_PATH_MAX)
            .map(f => ({ source_path: f.relativePath, reason: `Caminho com mais de ${SOURCE_PATH_MAX} caracteres.` }));
        const storable = fresh.filter(f => f.relativePath.length <= SOURCE_PATH_MAX);

        const rows = storable.map(f => {
            const parsed = parseLegacyFileName(f.fileName);
            return {
                source_file_name: f.fileName.slice(0, 255),
                source_path: f.relativePath,
                source_file_size: f.size,
                source_modified_at: f.modifiedAt,
                legacy_smartphone_code: parsed.ok ? parsed.legacyCode : null,
                reponsible_name: parsed.ok ? parsed.responsibleName : null,
                status: parsed.ok ? S.PENDING : ISSUE_STATUS[ISSUE.INVALID_NAME],
                issue_code: parsed.ok ? null : ISSUE.INVALID_NAME,
                message: parsed.ok ? null : clipMessage(parsed.reason),
                created_by: userId,
            };
        });

        const saved = rows.length ? await this.repository.insertScanned(rows) : { inserted: 0, failed: [] };
        failed.push(...saved.failed);
        const rejected = new Set(failed.map(f => f.source_path));
        const stored = rows.filter(r => !rejected.has(r.source_path));

        if (failed.length) {
            console.error(`[gapp-term-migration] ${failed.length} arquivo(s) não registrado(s) na varredura:`, failed.slice(0, 5));
        }

        if (stored.length) {
            const created = await this.repository.findIdsByPaths(stored.map(r => r.source_path));
            await this.repository.insertLogs(created.map(row => ({
                migrationId: row.migration_id, action: 'scan', fromStatus: null, toStatus: row.status,
                message: row.message ?? 'Arquivo identificado na pasta de origem.', userId,
            })));
        }

        return {
            found: files.length,
            registered: saved.inserted,
            already_known: files.length - fresh.length,
            invalid_name: stored.filter(r => r.issue_code === ISSUE.INVALID_NAME).length,
            // Arquivos que o banco recusou — os demais entraram normalmente
            failed: failed.length,
            failed_items: failed.slice(0, 100),
        };
    }

    // ── 2. Validação dos vínculos ────────────────────────────────────────────

    /**
     * Sem `ids`: os próximos `pending`. Com `ids`: essas linhas, se ainda não
     * migradas nem ignoradas (revalidar um `validated` é permitido).
     */
    async validate({ ids, limit } = {}, userId) {
        const idList = normalizeIdList(ids, VALIDATE_BATCH.max);
        const rows = await this.repository.selectBatch({
            statuses: idList ? VALIDATABLE_STATUSES : [S.PENDING],
            ids: idList,
            limit: idList ? idList.length || 1 : normalizeBatchSize(limit, VALIDATE_BATCH),
        });
        return this._validateRows(rows, userId, 'validate');
    }

    /** @private */
    async _validateRows(rows, userId, action) {
        const report = { processed: 0, validated: 0, not_found: 0, error: 0, skipped: 0, items: [] };
        if (!rows.length) return report;

        const parsed = new Map(rows.map(row => [row.migration_id, parseLegacyFileName(row.source_file_name)]));
        const codes = [...new Set([...parsed.values()].filter(p => p.ok).map(p => p.legacyCode))];
        const legacy = await this.repository.findLegacySmartphones(codes);

        const candidatesByRow = new Map();
        for (const row of rows) {
            const p = parsed.get(row.migration_id);
            const old = p.ok ? legacy.get(p.legacyCode) : null;
            candidatesByRow.set(row.migration_id, old ? legacyImeiCandidates(old) : []);
        }
        const imeis = [...new Set([...candidatesByRow.values()].flat().map(c => c.imei))];
        const phones = await this.repository.findSmartphonesByImeis(imeis);

        for (const row of rows) {
            const result = await this._evaluate(row, parsed.get(row.migration_id), legacy, candidatesByRow.get(row.migration_id), phones);
            const applied = await this.repository.applyValidation(row.migration_id, row.status, result, userId);

            if (!applied) {
                report.skipped += 1;
                continue;
            }
            report.processed += 1;
            report[result.status] = (report[result.status] ?? 0) + 1;
            report.items.push({ migration_id: row.migration_id, status: result.status, issue_code: result.issue_code, message: result.message });

            await this.repository.insertLogs([{
                migrationId: row.migration_id, action, fromStatus: row.status, toStatus: result.status, message: result.message, userId,
            }]);
        }
        return report;
    }

    /**
     * Decide uma linha. Ordem: nome → arquivo na pasta → legado → IMEI → ativo novo.
     * @private
     */
    async _evaluate(row, parsed, legacy, candidates, phones) {
        const fail = (issue, reason, extra = {}) => ({
            ...extra,
            status: ISSUE_STATUS[issue], issue_code: issue, message: clipMessage(reason),
            // Sem vínculo: nada da validação anterior sobrevive a uma falha
            imei: null, imei_source: null, active_id_fk: null,
        });

        if (!parsed.ok) return fail(ISSUE.INVALID_NAME, parsed.reason);

        const base = { legacy_smartphone_code: parsed.legacyCode, reponsible_name: parsed.responsibleName };

        if (!(await this.source.exists(row.source_path))) {
            return fail(ISSUE.SOURCE_FILE_MISSING, `Arquivo não encontrado na pasta de origem: ${row.source_path}`, base);
        }

        const old = legacy.get(parsed.legacyCode);
        if (!old) {
            return fail(ISSUE.LEGACY_NOT_FOUND, `Código ${parsed.legacyCode} não existe em GIPP.gs_smartphone.`, base);
        }

        const legacyData = { ...base, legacy_imei1: old.imei1 ?? null, legacy_imei2: old.imei2 ?? null };
        const match = resolveAssetMatch(candidates, phones);
        if (!match.ok) return fail(match.issue, match.reason, legacyData);

        return {
            ...legacyData,
            status: S.VALIDATED,
            issue_code: null,
            message: clipMessage(`Smartphone #${match.activeId} localizado pelo ${match.imeiSource} ${match.imei}.`),
            imei: match.imei,
            imei_source: match.imeiSource,
            active_id_fk: match.activeId,
        };
    }

    // ── 3. Migração ──────────────────────────────────────────────────────────

    /**
     * Migra os próximos `validated` (ou os `ids` pedidos, se `validated`), um a
     * um. Lote pequeno por padrão — o primeiro uso deve ser um lote de teste.
     */
    async migrate({ ids, limit } = {}, userId) {
        const idList = normalizeIdList(ids, MIGRATE_BATCH.max);
        const rows = await this.repository.selectBatch({
            statuses: [S.VALIDATED],
            ids: idList,
            limit: idList ? idList.length || 1 : normalizeBatchSize(limit, MIGRATE_BATCH),
        });

        const report = { processed: 0, migrated: 0, reused: 0, failed: 0, skipped: 0, aborted: null, items: [] };

        for (const row of rows) {
            const outcome = await this._migrateOne(row, userId);
            if (outcome.skipped) {
                report.skipped += 1;
                continue;
            }
            report.processed += 1;
            report.items.push(outcome.item);
            if (outcome.item.status === S.MIGRATED) {
                report.migrated += 1;
                if (outcome.reused) report.reused += 1;
            } else {
                report.failed += 1;
            }
            if (outcome.abort) {
                report.aborted = outcome.item.message;
                break;
            }
        }
        return report;
    }

    /** @private */
    async _migrateOne(row, userId) {
        if (!(await this.repository.claimForMigration(row.migration_id, userId))) {
            return { skipped: true }; // outra instância/aba pegou a linha
        }

        try {
            if (!row.active_id_fk || !(await this.repository.isSmartphoneAsset(row.active_id_fk))) {
                return this._fail(row, userId, ISSUE.ASSET_NOT_FOUND,
                    `O ativo #${row.active_id_fk ?? '?'} não está mais cadastrado como smartphone. Reprocesse para validar de novo.`);
            }

            const { file, sha256, fileNames } = await this.source.read(row.source_path);

            const existing = await this.repository.findExistingTerm(row.active_id_fk, sha256, fileNames);
            if (existing) {
                return this._finish(row, userId, {
                    assetTermId: existing.asset_term_id,
                    fileId: existing.file_id_fk,
                    message: `Vínculo já existia: termo #${existing.asset_term_id} reaproveitado, nada foi duplicado.`,
                }, true);
            }

            // Mesmo caminho do POST /gapp/asset-term: checa o ativo, grava pelo FileService e cria o vínculo
            const term = await this.termCreator.createAssetTerm(
                { reponsible_name: row.reponsible_name, active_id_fk: row.active_id_fk }, file, userId,
            );
            return this._finish(row, userId, {
                assetTermId: term.asset_term_id,
                fileId: term.file_id_fk,
                message: `Termo #${term.asset_term_id} criado e vinculado ao smartphone #${row.active_id_fk}.`,
            }, false);
        } catch (error) {
            const issue = error?.code === 'TERM_MIGRATION_SOURCE_FILE_MISSING'
                ? ISSUE.SOURCE_FILE_MISSING
                : Number(error?.statusCode) === 400 ? ISSUE.FILE_REJECTED : ISSUE.MIGRATION_FAILED;
            if (issue === ISSUE.MIGRATION_FAILED) {
                console.error(`[gapp-term-migration] Falha ao migrar #${row.migration_id}:`, error?.message);
            }
            const outcome = await this._fail(row, userId, issue, error?.message || 'Falha inesperada ao migrar o documento.');
            return { ...outcome, abort: isInfrastructureOutage(error) };
        }
    }

    /** @private */
    async _finish(row, userId, data, reused) {
        const applied = await this.repository.markMigrated(row.migration_id, data, userId);
        if (!applied) {
            // Só acontece se alguém mexeu na linha no meio (ex.: reprocessar com ela presa).
            // O termo existe; a próxima validação + migração vai reaproveitá-lo.
            console.error(`[gapp-term-migration] #${row.migration_id} migrado (termo #${data.assetTermId}), mas a linha mudou de status antes da marcação.`);
        }
        await this.repository.insertLogs([{
            migrationId: row.migration_id, action: 'migrate', fromStatus: S.PROCESSING, toStatus: S.MIGRATED, message: data.message, userId,
        }]);
        return {
            reused,
            item: {
                migration_id: row.migration_id, status: S.MIGRATED,
                asset_term_id: data.assetTermId, file_id: data.fileId, message: data.message,
            },
        };
    }

    /** @private */
    async _fail(row, userId, issue, reason) {
        const status = ISSUE_STATUS[issue];
        const message = clipMessage(reason);
        await this.repository.markFailed(row.migration_id, { status, issueCode: issue, message }, userId);
        await this.repository.insertLogs([{
            migrationId: row.migration_id, action: 'migrate', fromStatus: S.PROCESSING, toStatus: status, message, userId,
        }]);
        return { item: { migration_id: row.migration_id, status, issue_code: issue, message } };
    }

    // ── 4. Reprocessamento ───────────────────────────────────────────────────

    /** Devolve erros / não localizados / `processing` abandonado para a fila e valida de novo. */
    async retry({ ids, limit } = {}, userId) {
        const idList = normalizeIdList(ids, RETRY_BATCH.max);
        const rows = await this.repository.selectRetryBatch({
            ids: idList,
            limit: idList ? idList.length || 1 : normalizeBatchSize(limit, RETRY_BATCH),
        });

        const reset = [];
        for (const row of rows) {
            if (!(await this.repository.resetToPending(row.migration_id, row.status, userId))) continue;
            await this.repository.insertLogs([{
                migrationId: row.migration_id, action: 'retry', fromStatus: row.status, toStatus: S.PENDING,
                message: 'Devolvido para a fila para nova validação.', userId,
            }]);
            reset.push({ ...row, status: S.PENDING, active_id_fk: null, imei: null, imei_source: null });
        }

        const validation = await this._validateRows(reset, userId, 'validate');
        return { reset: reset.length, ...validation };
    }

    // ── Análise manual ───────────────────────────────────────────────────────

    async ignore(id, reason, userId) {
        const item = await this.getById(id);
        const message = clipMessage(reason ? `Ignorado: ${reason}` : 'Ignorado manualmente.');
        if (!(await this.repository.ignore(item.migration_id, message, userId))) {
            throw new AppError(`Não é possível ignorar um registro com status "${item.status}".`, 409, { code: 'TERM_MIGRATION_INVALID_TRANSITION' });
        }
        await this.repository.insertLogs([{ migrationId: item.migration_id, action: 'ignore', fromStatus: item.status, toStatus: S.IGNORED, message, userId }]);
        return this.getById(item.migration_id);
    }

    async restore(id, userId) {
        const item = await this.getById(id);
        if (!(await this.repository.restore(item.migration_id, userId))) {
            throw new AppError('Só um registro ignorado pode voltar para a fila.', 409, { code: 'TERM_MIGRATION_INVALID_TRANSITION' });
        }
        await this.repository.insertLogs([{
            migrationId: item.migration_id, action: 'restore', fromStatus: S.IGNORED, toStatus: S.PENDING,
            message: 'Devolvido para a fila.', userId,
        }]);
        return this.getById(item.migration_id);
    }
}

module.exports = { GappTermMigrationUseCases, VALIDATE_BATCH, MIGRATE_BATCH, RETRY_BATCH };
