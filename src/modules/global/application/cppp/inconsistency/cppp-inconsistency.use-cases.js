/**
 * @fileoverview Casos de uso da tela de tratamento: lista de inconsistências,
 * detalhe do dia, as duas visões de marcação e a lista de pessoas.
 *
 * Nada aqui é guardado: a lista é recalculada a cada consulta a partir do
 * espelho (AFD) e dos ajustes ativos — é o que faz a ocorrência "sair da
 * lista" assim que o ajuste certo é lançado, sem estado de "resolvido" para
 * dessincronizar. O volume cabe: agosto inteiro (111 pessoas) são ~10 mil
 * marcações, e as regras rodam em milissegundos.
 *
 * @module modules/global/application/cppp/inconsistency/cppp-inconsistency.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { normalizePagination, paginated, optionalFlag } = require('../../../domain/shared/pagination.rules');
const { IssueStatus, IssueType, PunchView, values } = require('../../../domain/cppp/cppp.enums');
const { analyse, summarise, groupByDay, closingBaselines, clock } = require('../../../domain/cppp/inconsistency/punch-inconsistency.rules');
const { applyAdjustments, classifyFindings } = require('../../../domain/cppp/inconsistency/treated-view.rules');
const { coverageUntil, resolveWindow } = require('../../../domain/cppp/inconsistency/analysis-window.rules');
const { identifierKind, isUsableIdentifier, IdentifierKind } = require('../../../domain/cppp/cpf.rules');
const { isDate, addDays, localDate, spanDays } = require('../../../domain/cppp/date.rules');
const { toApiAdjustment } = require('../../../domain/cppp/adjustment/adjustment.shaper');

const IDENTIFIER_RE = /^\d{11}$/;

class CpppInconsistencyUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/cppp-afd-repository.port').CpppAfdRepositoryPort} deps.afd
     * @param {import('../ports/cppp-adjustment-repository.port').CpppAdjustmentRepositoryPort} deps.adjustments
     * @param {import('../ports/cppp-collect-run-repository.port').CpppCollectRunRepositoryPort} deps.runs
     * @param {import('../ports/cppp-external.ports').CpppEmployeeDirectoryPort} deps.directory
     * @param {{rules: object, baselineDays: number, maxPeriodDays: number}} deps.config
     * @param {() => Date} [deps.now]
     * @param {{warn: Function}} [deps.logger]
     */
    constructor({ afd, adjustments, runs, directory, config, now = () => new Date(), logger = console }) {
        this.afd = afd;
        this.adjustments = adjustments;
        this.runs = runs;
        this.directory = directory;
        this.config = config;
        this.now = now;
        this.logger = logger;
    }

    /**
     * @route GET /cppp/inconsistencies
     * @param {object} query - `from`, `to`, `cpf`, `issue`, `status` (`pendente`
     *        padrão, `tratada`, `todas`), `page`, `limit`.
     */
    async list(query = {}) {
        const cpf = this._optionalIdentifier(query.cpf);
        const issue = query.issue || null;
        if (issue && !values(IssueType).includes(issue)) {
            throw new AppError(`'issue' deve ser um destes: ${values(IssueType).join(', ')}.`, 400);
        }
        const status = query.status || IssueStatus.PENDENTE;
        if (![...values(IssueStatus), 'todas'].includes(status)) {
            throw new AppError("'status' deve ser pendente, tratada ou todas.", 400);
        }

        const window = await this._window(query.from, query.to);
        const pagination = normalizePagination(query);

        if (window.empty) {
            return { window: this._windowOut(window), summary: { by_issue: {}, by_status: {}, employees: 0 }, ...paginated([], 0, pagination) };
        }

        const { items } = await this._analyse({ ...window, cpf });

        const byStatus = status === 'todas' ? items : items.filter((item) => item.status === status);
        const filtered = issue ? byStatus.filter((item) => item.issue === issue) : byStatus;

        const summary = {
            by_issue: summarise(byStatus),
            by_status: summarise(items.map((item) => ({ issue: item.status }))),
            employees: new Set(filtered.map((item) => item.cpf)).size,
        };

        const page = filtered.slice(pagination.offset, pagination.offset + pagination.limit);
        const { employees, lookupFailed } = await this._employees(page.map((item) => item.cpf));

        return {
            window: this._windowOut(window),
            summary,
            employee_lookup_failed: lookupFailed,
            ...paginated(page.map((item) => this._itemOut(item, employees)), filtered.length, pagination),
        };
    }

    /**
     * Tudo o que a tela precisa para tratar um dia sem sair dela.
     *
     * @route GET /cppp/days/:cpf/:date
     */
    async day(cpf, day) {
        if (!IDENTIFIER_RE.test(String(cpf))) throw new AppError('Identificador deve ter 11 dígitos.', 400);
        if (!isDate(day)) throw new AppError('Data deve estar no formato AAAA-MM-DD.', 400);

        const window = await this._window(day, day);
        const clockPunches = await this.afd.findDayPunches(cpf, day);
        const dayAdjustments = await this.adjustments.findForDay(cpf, day);
        const activeReadings = new Map(dayAdjustments
            .filter((adj) => !adj.canceledAt && adj.nsr)
            .map((adj) => [`${adj.deviceId}|${adj.nsr}`, adj.id]));

        let findings = [];
        let treatedPunches = [];
        let baseline = null;

        if (!window.empty && isUsableIdentifier(cpf)) {
            const { items, view } = await this._analyse({ ...window, cpf });
            findings = items.filter((item) => item.day === day);
            treatedPunches = view.punches
                .filter((punch) => punch.day === day)
                .sort((a, b) => a.time.localeCompare(b.time));

            const personDays = groupByDay(view.punches.filter((punch) => punch.cpf === cpf));
            const stats = closingBaselines(personDays).get(cpf);
            baseline = stats
                ? {
                    median_closing: clock(stats.medianMinutes),
                    baseline_days: stats.days,
                    min_baseline_days: this.config.rules.minBaselineDays,
                    sufficient: stats.days >= this.config.rules.minBaselineDays,
                    from: window.fetchFrom,
                    to: window.to,
                }
                : null;
        }

        const { employees, lookupFailed } = await this._employees([cpf]);

        return {
            cpf,
            day,
            identifier_kind: identifierKind(cpf),
            employee: employees.get(cpf) ?? null,
            employee_lookup_failed: lookupFailed,
            // `false` quando o dia está depois do corte (hoje, ou coleta
            // atrasada): as marcações aparecem, mas nada é apontado.
            analysed: !window.empty && isUsableIdentifier(cpf),
            cutoff: window.cutoff,
            // Visão AFD: como o relógio gravou, em ordem de NSR.
            punches: clockPunches.map((punch) => ({
                ...punch,
                disregarded_by: activeReadings.get(`${punch.device_id}|${punch.nsr}`) ?? null,
            })),
            // Visão tratada: o que a folha vai ler.
            treated_punches: treatedPunches.map((punch) => ({
                time: punch.time.slice(0, 5),
                source: punch.source,
                device_id: punch.deviceId,
                nsr: punch.nsr,
                adjustment_id: punch.adjustmentId,
            })),
            findings: findings.map((finding) => this._findingOut(finding)),
            baseline,
            adjustments: dayAdjustments.map(toApiAdjustment),
        };
    }

    /**
     * As duas visões, obteníveis separadamente: `afd` é a fiscal (paginada por
     * NSR, sem nenhum ajuste); `tratada` é AFD + ajustes, agrupada por dia.
     *
     * Não passa pelo corte do dia corrente — é consulta de marcação, não de
     * inconsistência.
     *
     * @route GET /cppp/punches?view=afd|tratada
     */
    async punches(query = {}) {
        const view = query.view || PunchView.AFD;
        if (!values(PunchView).includes(view)) throw new AppError("'view' deve ser afd ou tratada.", 400);

        const cpf = this._optionalIdentifier(query.cpf);
        const to = query.to || localDate(this.now());
        const from = query.from || addDays(to, -29);
        if (!isDate(from) || !isDate(to) || from > to) throw new AppError('Período inválido (AAAA-MM-DD).', 400);
        if (spanDays(from, to) > this.config.maxPeriodDays) {
            throw new AppError(`O período não pode passar de ${this.config.maxPeriodDays} dias.`, 400);
        }

        const pagination = normalizePagination(query);

        if (view === PunchView.AFD) {
            const { rows, total } = await this.afd.listPunches({
                from, to, cpf,
                deviceId: query.device_id ? Number(query.device_id) : null,
                ...pagination,
            });
            return { view, from, to, ...paginated(rows, total, pagination) };
        }

        const clockPunches = await this.afd.findPunches({ from, to, cpf });
        const active = await this.adjustments.findActiveInRange({ from, to, cpf });
        const treated = applyAdjustments(clockPunches, active);

        const days = new Map();
        for (const punch of treated.punches) {
            if (punch.day < from || punch.day > to) continue;
            const key = `${punch.cpf}|${punch.day}`;
            if (!days.has(key)) days.set(key, { cpf: punch.cpf, day: punch.day, punches: [] });
            days.get(key).punches.push(punch);
        }
        for (const [key, justifications] of treated.justifiedDays) {
            const [personCpf, day] = key.split('|');
            if (day < from || day > to) continue;
            if (!days.has(key)) days.set(key, { cpf: personCpf, day, punches: [] });
            days.get(key).justifications = justifications;
        }

        const ordered = [...days.values()].sort((a, b) => a.day.localeCompare(b.day) || a.cpf.localeCompare(b.cpf));
        const page = ordered.slice(pagination.offset, pagination.offset + pagination.limit).map((entry) => ({
            cpf: entry.cpf,
            day: entry.day,
            punches: entry.punches
                .sort((a, b) => a.time.localeCompare(b.time))
                .map((punch) => ({
                    time: punch.time.slice(0, 5),
                    source: punch.source,
                    device_id: punch.deviceId,
                    nsr: punch.nsr,
                    adjustment_id: punch.adjustmentId,
                })),
            justifications: (entry.justifications ?? []).map(toApiAdjustment),
        }));

        return { view, from, to, ...paginated(page, ordered.length, pagination) };
    }

    /**
     * Pessoas conhecidas do relógio — alimenta o filtro por funcionário.
     *
     * @route GET /cppp/employees?search=
     */
    async employees(query = {}) {
        const pagination = normalizePagination(query);
        const search = String(query.search ?? '').trim() || null;
        // O cadastro do relógio tem ~1.400 identificadores e ~111 batem ponto:
        // por padrão só quem tem marcação; `?all=1` traz todos.
        const onlyWithPunches = optionalFlag(query.all) !== 1;
        const { rows, total } = await this.afd.listEmployees({ search, onlyWithPunches, ...pagination });
        const { employees, lookupFailed } = await this._employees(rows.map((row) => row.cpf));

        return {
            employee_lookup_failed: lookupFailed,
            ...paginated(rows.map((row) => ({
                ...row,
                identifier_kind: identifierKind(row.cpf),
                employee: employees.get(row.cpf) ?? null,
            })), total, pagination),
        };
    }

    // ─── internos ────────────────────────────────────────────────────────────

    async _window(from, to) {
        const lastSuccess = await this.runs.lastSuccessByDevice();
        return resolveWindow({
            from: from || undefined,
            to: to || undefined,
            today: localDate(this.now()),
            coverage: coverageUntil(lastSuccess.map((row) => row.lastSuccessAt)),
            baselineDays: this.config.baselineDays,
            maxPeriodDays: this.config.maxPeriodDays,
        });
    }

    _windowOut(window) {
        return {
            from: window.from,
            to: window.to,
            cutoff: window.cutoff,
            // Sem coleta concluída não há o que analisar — a tela diz isso em
            // vez de mostrar lista vazia como se estivesse tudo certo.
            no_collection: window.cutoff === null,
        };
    }

    /**
     * Roda as regras nas duas visões e classifica.
     *
     * Lê desde `fetchFrom` (histórico do `fecha_cedo`), mas só devolve
     * ocorrências de `[from, to]`.
     */
    async _analyse({ from, to, fetchFrom, cpf = null }) {
        const clockPunches = (await this.afd.findPunches({ from: fetchFrom, to, cpf }))
            .filter((punch) => isUsableIdentifier(punch.cpf));
        const active = await this.adjustments.findActiveInRange({ from: fetchFrom, to, cpf });

        const view = applyAdjustments(clockPunches, active);
        const raw = analyse(clockPunches, this.config.rules);
        const treated = analyse(view.punches, this.config.rules);

        const items = classifyFindings(raw, treated, view.justifiedDays)
            .filter((item) => item.day >= from && item.day <= to);

        return { items, view };
    }

    /**
     * Contrato no Protheus, com o nome do cadastro do relógio como reserva.
     *
     * Falha do SQL Server NÃO derruba a tela: o tratamento do ponto funciona
     * pelo identificador, e o nome é conforto. A resposta avisa.
     */
    async _employees(cpfs) {
        const unique = [...new Set(cpfs)].filter(Boolean);
        const employees = new Map();
        if (!unique.length) return { employees, lookupFailed: false };

        let protheus = new Map();
        let lookupFailed = false;
        const searchable = unique.filter((cpf) => identifierKind(cpf) !== IdentifierKind.INVALIDO);
        try {
            if (searchable.length) protheus = await this.directory.findByIdentifiers(searchable);
        } catch (error) {
            lookupFailed = true;
            this.logger.warn('[cppp] busca de funcionários no Protheus falhou:', error.message);
        }

        const fromClock = await this.afd.clockNames(unique);

        for (const cpf of unique) {
            const contract = protheus.get(cpf);
            const clockEntry = fromClock.get(cpf);
            employees.set(cpf, contract
                ? { ...contract, source: 'protheus', clock_name: clockEntry?.name ?? null }
                : { name: clockEntry?.name ?? null, source: clockEntry?.name ? 'relogio' : null, contract_status: null, clock_name: clockEntry?.name ?? null });
        }
        return { employees, lookupFailed };
    }

    _findingOut(finding) {
        return {
            cpf: finding.cpf,
            day: finding.day,
            issue: finding.issue,
            status: finding.status,
            detail: finding.detail,
            context: finding.context,
            punch_count: finding.punchCount,
            times: finding.times,
        };
    }

    _itemOut(item, employees) {
        return { ...this._findingOut(item), employee: employees.get(item.cpf) ?? null };
    }

    _optionalIdentifier(value) {
        if (value === undefined || value === null || value === '') return null;
        const digits = String(value).replace(/\D/g, '');
        if (!IDENTIFIER_RE.test(digits)) throw new AppError("'cpf' deve ter 11 dígitos.", 400);
        return digits;
    }
}

module.exports = { CpppInconsistencyUseCases };
