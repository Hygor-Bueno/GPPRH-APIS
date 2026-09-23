/**
 * @fileoverview Rasteriza a grade em imagem, com Chromium.
 *
 * ─── Por que o navegador abre e FECHA a cada ciclo ───────────────────────────
 *
 * O `receipt.generator` mantém um Chromium vivo entre requisições, e o
 * `docker-compose.yml` documenta a consequência: ~800 MB de processos órfãos
 * acumulados, que o `max_memory_restart` do PM2 não pega porque o Chromium é
 * processo-filho. Repetir esse desenho num job que roda a cada poucos minutos
 * transformaria um vazamento tolerado num vazamento que derruba o container.
 *
 * Aqui o ciclo inteiro é `launch → renderiza N grades → close`, com o `close`
 * em `finally`. Uma grade é uma página estática sem rede: o custo do launch
 * (~1 s) é irrelevante perto do intervalo, e o que se ganha é a garantia de que
 * nada sobrevive ao ciclo.
 *
 * @module modules/global/infrastructure/miepp/miepp-grid-renderer.service
 */

const fs = require('fs');
const puppeteer = require('puppeteer');

const { renderGridHtml } = require('../../../../templates/miepp-grid/grid.template');

/** Mesmas flags do gerador de recibo — validadas neste servidor. */
const LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    // Crítico em container: /dev/shm padrão do Docker é 64 MB e o Chromium
    // trava ao estourá-lo. O compose ainda sobe shm_size para 256m por cima.
    '--disable-dev-shm-usage',
    '--disable-gpu',
    // Sem isto, o Chromium reduz o trabalho de páginas "em segundo plano" —
    // e toda página do renderizador é de segundo plano.
    '--disable-background-timer-throttling',
];

/** Teto por página. Página estática sem rede não deveria passar de 1 s. */
const PAGE_TIMEOUT_MS = 30000;

class MieppGridRendererService {
    /**
     * @param {object} [options]
     * @param {number} [options.width]  - largura da imagem final.
     * @param {number} [options.height]
     */
    constructor({ width = 1920, height = 1080 } = {}) {
        this.width = width;
        this.height = height;
        this.browser = null;
    }

    /** Abre o Chromium do ciclo. Idempotente. */
    async open() {
        if (this.browser) return this.browser;
        this.browser = await puppeteer.launch({ headless: 'new', args: LAUNCH_ARGS });
        return this.browser;
    }

    /**
     * Fecha o Chromium do ciclo. Nunca lança — o ciclo já terminou, e um erro
     * aqui não pode mascarar o resultado do render nem impedir o próximo ciclo.
     */
    async close() {
        if (!this.browser) return;
        try {
            await this.browser.close();
        } catch (error) {
            console.error('[miepp-grid] Falha ao fechar o Chromium:', error.message);
        } finally {
            this.browser = null;
        }
    }

    /**
     * Lê o fundo do disco como data URI.
     *
     * Ausência de fundo NÃO é erro: a grade renderiza sobre a cor sólida. Fundo
     * que existe no banco mas sumiu do disco também não derruba o ciclo — vira
     * aviso e a grade sai sem fundo, porque ficar sem preço na parede é pior
     * que ficar sem imagem atrás dele.
     *
     * @param {{absolutePath: string, mimeType: string}|null} background
     * @returns {string|null}
     */
    static toDataUri(background) {
        if (!background) return null;
        try {
            const bytes = fs.readFileSync(background.absolutePath);
            return `data:${background.mimeType};base64,${bytes.toString('base64')}`;
        } catch (error) {
            console.error('[miepp-grid] Fundo ilegível, seguindo sem ele:', error.message);
            return null;
        }
    }

    /**
     * Gera o PNG da grade.
     *
     * PNG e não JPEG: a grade é texto grande sobre fundo chapado, onde o JPEG
     * cria halo ao redor dos números. E PNG é determinístico para o mesmo HTML,
     * o que mantém o `checksum` estável quando o conteúdo não muda — a premissa
     * do `data_hash`.
     *
     * @param {object} params
     * @param {number} params.columns
     * @param {number} params.rows
     * @param {object[]} params.items
     * @param {{absolutePath: string, mimeType: string}|null} params.background
     * @param {object} [params.style] - estilo já normalizado e validado.
     * @returns {Promise<Buffer>}
     */
    async render({ columns, rows, items, background, style }) {
        const browser = await this.open();
        const page = await browser.newPage();

        try {
            page.setDefaultTimeout(PAGE_TIMEOUT_MS);
            await page.setViewport({ width: this.width, height: this.height, deviceScaleFactor: 1 });

            const html = renderGridHtml({
                columns,
                rows,
                width: this.width,
                height: this.height,
                backgroundDataUri: MieppGridRendererService.toDataUri(background),
                items,
                style,
            });

            // `domcontentloaded` e não `networkidle0`: a página não faz uma
            // requisição sequer (o fundo é data URI), então esperar a rede
            // ficar ociosa é esperar por um evento que já aconteceu.
            await page.setContent(html, { waitUntil: 'domcontentloaded' });

            return await page.screenshot({ type: 'png', fullPage: false });
        } finally {
            try { await page.close(); } catch { /* browser pode já ter caído */ }
        }
    }
}

module.exports = { MieppGridRendererService, LAUNCH_ARGS, PAGE_TIMEOUT_MS };
