/**
 * @fileoverview Casos de uso da coleta do relógio: enfileirar (tela), executar
 * (worker), histórico e AFD bruto.
 *
 * ─── Quem fala com o relógio ─────────────────────────────────────────────────
 * Só o worker (`workers/cppp-afd-collector.js`). A rota de coleta apenas
 * ENFILEIRA: a API roda em cluster de 2 instâncias, uma coleta integral leva
 * até 180s, e uma requisição HTTP presa esse tempo cairia no timeout do
 * Apache. A tela acompanha lendo a coleta (`GET /collect-runs/:id`).
 *
 * ─── A ordem de uma execução ─────────────────────────────────────────────────
 *   1. decide de onde pedir (fim do primeiro bloco contínuo de NSR);
 *   2. baixa o AFD;
 *   3. grava o BRUTO em disco antes de qualquer parse — se o parse falhar, o
 *      que o equipamento mandou está preservado;
 *   4. confere identidade do REP, continuidade, trailer;
 *   5. grava só os NSRs novos; idênticos são contados, divergentes acusados e
 *      NUNCA sobrescritos.
 *
 * @module modules/global/application/cppp/collect/cppp-collect.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { normalizePagination, paginated } = require('../../../domain/shared/pagination.rules');
const { CollectRunStatus, CollectTrigger, TrailerCheck } = require('../../../domain/cppp/cppp.enums');
const { parseAfd, decodeAfd } = require('../../../domain/cppp/afd/afd.parser');
const { findNsrGaps, checkTrailer, splitByExisting, formatGaps } = require('../../../domain/cppp/afd/afd-integrity.rules');
const { isScheduleDue, resolveCollectRequest } = require('../../../domain/cppp/collect/collect-schedule.rules');
const { normalizeDevice, normalizeBaseUrl, assertRepNumberChange } = require('../../../domain/cppp/device/device.rules');

/** Teto de coletas executadas por ciclo do worker. */
const MAX_RUNS_PER_CYCLE = 10;

class CpppCollectUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/cppp-collect-run-repository.port').CpppCollectRunRepositoryPort} deps.runs
     * @param {import('../ports/cppp-device-repository.port').CpppDeviceRepositoryPort} deps.devices
     * @param {import('../ports/cppp-afd-repository.port').CpppAfdRepositoryPort} deps.afd
     * @param {import('../ports/cppp-external.ports').CpppClockClientPort} [deps.clock]       - coleta (worker) e teste de conexão (API).
     * @param {import('../ports/cppp-external.ports').CpppRawAfdStoragePort} deps.rawStorage
     * @param {{collectTime: string, stuckRunMinutes: number, allowedNetworks: string[]}} deps.config
     * @param {() => Date} [deps.now]
     */
    constructor({ runs, devices, afd, clock = null, rawStorage, config, now = () => new Date() }) {
        this.runs = runs;
        this.devices = devices;
        this.afd = afd;
        this.clock = clock;
        this.rawStorage = rawStorage;
        this.config = config;
        this.now = now;
    }

    // ─── Relógios ────────────────────────────────────────────────────────────

    async listDevices() {
        return this.devices.listWithLastRun();
    }

    async getDevice(id) {
        const device = await this.devices.findById(Number(id));
        if (!device) throw new AppError('Relógio não encontrado.', 404);
        return device;
    }

    /**
     * Cadastra um relógio pela tela. Cada relógio tem o seu IP; login e senha
     * são os mesmos para todos e ficam no `.env`.
     */
    async createDevice({ input, actor }) {
        const userId = this._requireActor(actor);
        const device = normalizeDevice(input, { creating: true, allowedNetworks: this.config.allowedNetworks });
        const id = await this.devices.insert(device, userId);
        return this.devices.findById(id);
    }

    /**
     * Edita nome, IP, REP ou ativo. O código não muda (está no caminho dos
     * arquivos de AFD), e o REP não troca depois que há registros — outro
     * equipamento é outro cadastro.
     */
    async updateDevice({ id, input, actor }) {
        const userId = this._requireActor(actor);
        const current = await this.getDevice(id);
        const fields = normalizeDevice(input, { creating: false, allowedNetworks: this.config.allowedNetworks });

        if ('repNumber' in fields) {
            assertRepNumberChange({
                current: current.rep_number,
                next: fields.repNumber,
                hasRecords: await this.devices.hasRecords(current.id),
            });
        }

        await this.devices.update(current.id, fields, userId);
        return this.devices.findById(current.id);
    }

    /**
     * Testa um relógio já cadastrado (login + logout). Falha de conexão NÃO é
     * erro da API: volta 200 com `ok: false` e o motivo, que é o que a tela
     * precisa mostrar.
     */
    async testDevice(id) {
        return this._testConnection(await this.getDevice(id));
    }

    /** Testa um IP antes de salvar o cadastro — mesmas restrições de rede do cadastro. */
    async testAddress(baseUrl) {
        const url = normalizeBaseUrl(baseUrl, this.config.allowedNetworks);
        return this._testConnection({ code: null, base_url: url });
    }

    async _testConnection(device) {
        if (!this.clock) throw new Error('Cliente do relógio não configurado neste processo.');
        try {
            const { elapsedMs } = await this.clock.testConnection(device);
            return { ok: true, base_url: device.base_url, elapsed_ms: elapsedMs, message: 'Relógio respondeu e aceitou o login.' };
        } catch (error) {
            return { ok: false, base_url: device.base_url, elapsed_ms: null, message: error.message };
        }
    }

    _requireActor(actor) {
        const id = Number(actor?.id);
        if (!Number.isInteger(id) || id < 1) throw new AppError('Sessão sem usuário identificado.', 401);
        return id;
    }

    // ─── Coletas (tela) ──────────────────────────────────────────────────────

    /**
     * @param {{deviceId: number, actor: {id: number}}} input
     * @returns {Promise<object>} a coleta enfileirada.
     */
    async requestCollect({ deviceId, actor }) {
        const device = await this.devices.findById(deviceId);
        if (!device) throw new AppError('Relógio não encontrado.', 404);
        if (!device.active) throw new AppError('Relógio desativado — não é coletado.', 409);

        const id = await this.runs.enqueue({
            deviceId,
            trigger: CollectTrigger.MANUAL,
            requestedBy: actor?.id ?? null,
        });

        if (id === null) {
            const active = await this.runs.findActive(deviceId);
            throw new AppError(
                `Já existe uma coleta ${active?.status === CollectRunStatus.RUNNING ? 'em andamento' : 'na fila'} para este relógio (#${active?.id ?? '?'}).`,
                409,
                { code: 'CPPP_COLLECT_ALREADY_ACTIVE' },
            );
        }

        return this.runs.findById(id);
    }

    async listRuns(query = {}) {
        const pagination = normalizePagination(query);
        const { rows, total } = await this.runs.list({
            ...pagination,
            deviceId: query.device_id ? Number(query.device_id) : null,
            status: query.status || null,
        });
        return paginated(rows, total, pagination);
    }

    async getRun(id) {
        const run = await this.runs.findById(Number(id));
        if (!run) throw new AppError('Coleta não encontrada.', 404);
        return run;
    }

    /** @returns {Promise<{absolutePath: string, fileName: string}>} */
    async rawAfd(id) {
        const run = await this.getRun(id);
        if (!run.raw_file_path) {
            throw new AppError('Esta coleta não chegou a receber o AFD do relógio.', 404);
        }
        return this.rawStorage.resolve(run.raw_file_path, run.raw_sha256);
    }

    // ─── Worker ──────────────────────────────────────────────────────────────

    /**
     * Um ciclo do worker. Chamado SEMPRE dentro do `GET_LOCK` — não há outra
     * proteção contra dois ciclos simultâneos.
     *
     * @returns {Promise<{stuck: number, scheduled: number, executed: object[]}>}
     */
    async runCycle() {
        const stuck = await this.runs.failStuck(this.config.stuckRunMinutes);
        const scheduled = await this.enqueueDue();

        const executed = [];
        for (let i = 0; i < MAX_RUNS_PER_CYCLE; i++) {
            const run = await this.runs.nextQueued();
            if (!run) break;
            const result = await this.execute(run);
            if (result) executed.push(result);
        }

        return { stuck, scheduled, executed };
    }

    /** Enfileira a coleta diária dos relógios cujo horário já passou. */
    async enqueueDue() {
        let scheduled = 0;
        for (const device of await this.devices.listActive()) {
            const lastScheduledAt = await this.runs.lastScheduledAt(device.id);
            if (!isScheduleDue({ now: this.now(), collectTime: this.config.collectTime, lastScheduledAt })) continue;

            // `null` = já há coleta viva (ex.: alguém disparou pela tela às
            // 01:59). A agendada continua devida e entra no próximo ciclo,
            // depois que aquela terminar.
            const id = await this.runs.enqueue({ deviceId: device.id, trigger: CollectTrigger.SCHEDULE, requestedBy: null });
            if (id !== null) scheduled += 1;
        }
        return scheduled;
    }

    /**
     * Executa uma coleta enfileirada.
     *
     * @param {object} run - linha de `cppp_collect_runs`.
     * @returns {Promise<{id: number, status: string, inserted: number}|null>}
     *          `null` se outro processo já a pegou.
     */
    async execute(run) {
        if (!(await this.runs.claim(run.id))) return null;

        let stored = null;
        try {
            const device = await this.devices.findById(run.device_id);
            if (!device) throw new AppError('Relógio da coleta não existe mais.', 404);
            if (!this.clock) throw new Error('Cliente do relógio não configurado neste processo.');

            const { initialNsr, requestedFrom } = resolveCollectRequest(await this.afd.lastContiguousNsr(device.id));
            await this.runs.setRequestedFrom(run.id, requestedFrom);

            const buffer = await this.clock.fetchAfd(device, { initialNsr });

            // Bruto ANTES do parse: é registro fiscal, e precisa existir mesmo
            // que o resto desta coleta falhe.
            stored = await this.rawStorage.save({ deviceCode: device.code, runId: run.id, buffer });

            const result = await this._ingest({ device, run, buffer, initialNsr });
            await this.runs.finish(run.id, { ...result, ...this._rawFields(stored) });
            return { id: run.id, status: result.status, inserted: result.inserted };
        } catch (error) {
            await this.runs.finish(run.id, {
                status: CollectRunStatus.FAILED,
                error: error.message,
                ...this._rawFields(stored),
            });
            return { id: run.id, status: CollectRunStatus.FAILED, inserted: 0, error: error.message };
        }
    }

    _rawFields(stored) {
        return stored
            ? { rawFilePath: stored.relativePath, rawSha256: stored.sha256, rawBytes: stored.bytes }
            : {};
    }

    /**
     * Confere e grava o que veio do relógio.
     *
     * Coleta com erro grava o que for válido (cada linha é registro fiscal por
     * si) e termina `failed`. Como a análise só confia em coleta `success` para
     * saber até que dia os dados estão completos, uma falha nunca faz a tela
     * mostrar dia pela metade.
     */
    async _ingest({ device, buffer, run, initialNsr }) {
        const parsed = parseAfd(decodeAfd(buffer));
        const errors = [];
        const warnings = [];

        // Identidade ANTES de gravar: com dois relógios, um IP trocado
        // carregaria os registros de um sob o id do outro, e o espelho é
        // imutável — não haveria como desfazer.
        const declaredRep = parsed.footer?.repNumber ?? null;
        if (declaredRep && device.rep_number && declaredRep !== device.rep_number) {
            throw new AppError(
                `O AFD recebido é do REP ${declaredRep}, mas o relógio cadastrado é o REP ${device.rep_number}. Nada foi gravado — confira a URL do relógio.`,
                409,
                { code: 'CPPP_REP_MISMATCH' },
            );
        }
        if (declaredRep && !device.rep_number) {
            // Relógio cadastrado pela tela sem REP: aprende na primeira coleta.
            // Antes, confere que nenhum OUTRO cadastro já é este equipamento —
            // dois cadastros para o mesmo relógio duplicariam o espelho sob
            // dois ids, e o espelho não se desfaz.
            const owner = await this.devices.findByRepNumber(declaredRep);
            if (owner && owner.id !== device.id) {
                throw new AppError(
                    `O AFD recebido é do REP ${declaredRep}, que já está cadastrado como o relógio ${owner.code} (${owner.name}). Dois cadastros apontam para o mesmo equipamento — confira o IP. Nada foi gravado.`,
                    409,
                    { code: 'CPPP_REP_MISMATCH' },
                );
            }
            await this.devices.setRepNumberIfEmpty(device.id, declaredRep);
        }

        const { records } = parsed;
        const nsrs = records.map((record) => record.nsr);
        // reduce, e não Math.min(...nsrs): o AFD integral já passa de 44 mil
        // linhas, e espalhar isso em argumentos estoura a pilha com o tempo.
        const firstNsr = nsrs.length ? nsrs.reduce((a, b) => (b < a ? b : a)) : null;
        const lastNsr = nsrs.length ? nsrs.reduce((a, b) => (b > a ? b : a)) : null;
        const gaps = findNsrGaps(nsrs, initialNsr);
        const trailer = checkTrailer(records, parsed.trailer);

        let inserted = 0;
        let identical = 0;
        let conflicts = [];

        if (records.length) {
            const existing = await this.afd.findRawLines(device.id, firstNsr, lastNsr);
            const split = splitByExisting(records, existing);
            identical = split.identical;
            conflicts = split.conflicts;
            if (split.fresh.length) inserted = await this.afd.insertRecords(device.id, run.id, split.fresh);
        }

        if (gaps.length) {
            errors.push(`NSR ausente na resposta do relógio: ${formatGaps(gaps)}. A próxima coleta pede de novo a partir do primeiro buraco.`);
        }
        if (conflicts.length) {
            const sample = conflicts.slice(0, 20).join(', ');
            errors.push(`${conflicts.length} NSR já gravado(s) chegaram com conteúdo diferente (${sample}${conflicts.length > 20 ? ', …' : ''}). O espelho NÃO foi alterado.`);
        }
        if (trailer.check === TrailerCheck.MISMATCH) {
            warnings.push(`Contagem por tipo diverge do trailer do AFD: declarado ${JSON.stringify(trailer.expected)}, recebido ${JSON.stringify(trailer.found)}.`);
        }
        if (parsed.unknown.length) {
            warnings.push(`${parsed.unknown.length} linha(s) não reconhecida(s) no AFD.`);
        }

        return {
            status: errors.length ? CollectRunStatus.FAILED : CollectRunStatus.SUCCESS,
            extracted: records.length,
            inserted,
            identical,
            rejected: parsed.unknown.length,
            conflicts: conflicts.length,
            firstNsr,
            lastNsr,
            trailerCheck: trailer.check,
            error: errors.join(' ') || null,
            warnings: warnings.join(' ') || null,
        };
    }
}

module.exports = { CpppCollectUseCases, MAX_RUNS_PER_CYCLE };
