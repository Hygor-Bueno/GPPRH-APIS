const puppeteer = require("puppeteer");
const { gerarHtmlRecibos } = require("./receipt.template");

let browser = null;
let isLaunching = false;
let launchQueue = [];

async function getBrowser() {
  // Instância existe e está conectada — reutiliza
  if (browser && browser.connected) {
    return browser;
  }

  // Já está sendo criada — entra na fila e aguarda
  if (isLaunching) {
    return new Promise((resolve, reject) => {
      launchQueue.push({ resolve, reject });
    });
  }

  isLaunching = true;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",  // ← crítico em servidores Linux
        "--disable-gpu",
      ]
    });

    // Quando o browser fechar/crashar, nulifica para recriar na próxima chamada
    browser.on("disconnected", () => {
      console.warn("[Puppeteer] Browser desconectado — será recriado na próxima requisição");
      browser = null;
    });

    launchQueue.forEach(({ resolve }) => resolve(browser));
    return browser;
  } catch (err) {
    browser = null;
    launchQueue.forEach(({ reject }) => reject(err));
    throw err;
  } finally {
    isLaunching = false;
    launchQueue = [];
  }
}

async function generateReceipt(recibos) {
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let page = null;
    try {
      const browserInstance = await getBrowser();
      page = await browserInstance.newPage();

      const html = gerarHtmlRecibos(recibos);
      await page.setContent(html, { waitUntil: "networkidle0" });

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" }
      });

      return pdfBuffer;
    } catch (err) {
      const isConnError =
        err.message?.includes("Connection closed") ||
        err.message?.includes("Target closed") ||
        err.message?.includes("Session closed");

      console.error(`[Puppeteer] Tentativa ${attempt}/${MAX_RETRIES} falhou:`, err.message);

      if (isConnError && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 300 * attempt)); // backoff: 300ms, 600ms
        continue;
      }

      throw err;
    } finally {
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
    }
  }
}

module.exports = { generateReceipt };