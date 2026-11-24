/**
 * @fileoverview Adapter Puppeteer — implementa `DossierPdfRendererPort`.
 *
 * ─── Por que o navegador abre e FECHA a cada dossiê ──────────────────────────
 *
 * Mesmo desenho do `miepp-grid-renderer.service`: o Chromium que o
 * `receipt.generator` mantém vivo já deixou ~800 MB de processos órfãos no
 * container (o `max_memory_restart` do PM2 não enxerga processo-filho). O
 * dossiê é gerado sob demanda e com pouca frequência; ~1 s de launch é barato
 * perto da garantia de que nada sobrevive à requisição.
 *
 * ─── Fila ────────────────────────────────────────────────────────────────────
 *
 * Cada geração sobe um Chromium inteiro. Para um clique repetido ou vários
 * gestores ao mesmo tempo não multiplicarem isso, o adapter limita gerações
 * simultâneas e a fila de espera POR PROCESSO (são 2 no cluster); passando da
 * fila, responde 503 `GTPP_DOSSIER_BUSY` em vez de acumular memória.
 *
 * ─── Reuso ───────────────────────────────────────────────────────────────────
 *
 * `renderPdf({ html, headerTemplate, footerTemplate })` é genérico: o
 * relatório de auditoria do GAPP usa o mesmo adapter (instância própria, com
 * a própria fila e as próprias mensagens em `errors`).
 *
 * @module modules/global/infrastructure/gtpp/puppeteer-task-dossier.renderer
 */

const puppeteer = require('puppeteer');

const { AppError } = require('../../../../errors/app.error');
const { DossierPdfRendererPort } = require('../../application/gtpp/task-dossier/ports/dossier-pdf-renderer.port');
const { GtppDossierErrorCode } = require('../../domain/gtpp/task-dossier/task-dossier.enums');
const {
    renderTaskDossierHtml,
    buildPdfHeaderTemplate,
    buildPdfFooterTemplate,
} = require('../../../../templates/gtpp-dossier/task-dossier.template');

/** Mesmas flags do gerador de recibo e do MIEPP — validadas neste servidor. */
const LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
];

/** Mensagens e códigos de recusa; o padrão é o do dossiê. */
const DOSSIER_ERRORS = Object.freeze({
    busy: { message: 'Há muitos dossiês sendo gerados agora. Tente novamente em instantes.', code: GtppDossierErrorCode.BUSY },
    failed: { message: 'Não foi possível gerar o dossiê da tarefa.', code: GtppDossierErrorCode.RENDER_FAILED },
});

/** Pior caso medido no design: 53 páginas, ~1,4 MB. Folga para o servidor carregado. */
const PAGE_TIMEOUT_MS = 90000;

const MAX_ACTIVE = 2;
const MAX_QUEUED = 4;

class PuppeteerTaskDossierRenderer extends DossierPdfRendererPort {
    /**
     * @param {object} [options]
     * @param {string} [options.executablePath] - Chromium alternativo (só para gerar fora do container).
     * @param {typeof DOSSIER_ERRORS} [options.errors] - recusas (fila cheia / falha) de quem reusa o adapter.
     */
    constructor({ executablePath, errors = DOSSIER_ERRORS } = {}) {
        super();
        this.executablePath = executablePath;
        this.errors = errors;
        this.active = 0;
        this.waiting = [];
    }

    render(dossier) {
        return this.renderPdf({
            html: renderTaskDossierHtml(dossier),
            headerTemplate: buildPdfHeaderTemplate({
                logo: dossier.brand?.logo, taskId: dossier.task.id, title: dossier.task.title,
            }),
            footerTemplate: buildPdfFooterTemplate({
                generatedAt: dossier.generated_at, generatedByName: dossier.generated_by?.name,
            }),
        });
    }

    /**
     * HTML pronto → PDF A4 com cabeçalho e rodapé do Puppeteer.
     * @param {{ html: string, headerTemplate: string, footerTemplate: string }} input
     * @returns {Promise<Buffer>}
     */
    async renderPdf(input) {
        await this._acquire();
        let browser = null;
        try {
            browser = await puppeteer.launch({
                headless: 'new',
                args: LAUNCH_ARGS,
                ...(this.executablePath ? { executablePath: this.executablePath } : {}),
            });
            return await this._print(await browser.newPage(), input);
        } catch (error) {
            if (error instanceof AppError) throw error;
            const { message, code } = this.errors.failed;
            throw new AppError(message, 500, { code, details: error.message });
        } finally {
            if (browser) await browser.close().catch(() => {});
            this._release();
        }
    }

    /** @private */
    async _print(page, { html, headerTemplate, footerTemplate }) {
        page.setDefaultTimeout(PAGE_TIMEOUT_MS);
        // Sem rede: tudo é inline (miniaturas e logo em data URI).
        await page.setContent(html, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
        await page.emulateMediaType('print');
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            preferCSSPageSize: false,
            margin: { top: '24mm', right: '14mm', bottom: '18mm', left: '14mm' },
            headerTemplate,
            footerTemplate,
            timeout: PAGE_TIMEOUT_MS,
        });
        return Buffer.from(pdf);
    }

    /** @private */
    _acquire() {
        if (this.active < MAX_ACTIVE) {
            this.active += 1;
            return Promise.resolve();
        }
        if (this.waiting.length >= MAX_QUEUED) {
            const { message, code } = this.errors.busy;
            return Promise.reject(new AppError(message, 503, { code }));
        }
        // A vaga é repassada direto por `_release`, sem passar pelo contador.
        return new Promise(resolve => this.waiting.push(resolve));
    }

    /** @private */
    _release() {
        const next = this.waiting.shift();
        if (next) next();
        else this.active -= 1;
    }
}

module.exports = { PuppeteerTaskDossierRenderer };
