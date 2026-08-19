/**
 * @fileoverview Trilha de auditoria em CSV do fechamento de jornada.
 *
 * Registra quem finalizou, quando, qual jornada e o que aconteceu com ela —
 * inclusive o motivo quando o recibo não é gerado. Existe porque o resultado do
 * fechamento hoje só vive na resposta HTTP: se o RH fecha uma loja e alguma
 * jornada falha, não sobra rastro depois que a tela é fechada.
 *
 * Gravado em `logs/`, bind mount próprio — deliberadamente fora de `storage/`,
 * que guarda anexos de usuário. Misturar log operacional com conteúdo de
 * usuário complica backup e limpeza. O arquivo é alcançável tanto no servidor
 * quanto pelo compartilhamento de rede.
 *
 * ⚠️ Falha de escrita NUNCA propaga. Um problema de disco ou permissão não pode
 * derrubar um fechamento que já commitou status 4 no banco.
 *
 * @module modules/gipp/infrastructure/csv-close-audit.logger
 */

const fs   = require('fs');
const path = require('path');

/** `__dirname` = .../src/modules/gipp/infrastructure → 4 níveis até a raiz. */
const LOG_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'logs');

/**
 * Separador `;` e BOM UTF-8 são obrigatórios para o Excel brasileiro: com `,`
 * ele joga a linha inteira numa coluna só, e sem BOM os acentos viram lixo.
 */
const SEPARATOR = ';';
const BOM       = '﻿';

const HEADER = [
    'data', 'hora', 'matricula', 'filial', 'cod_work_schedule',
    'status', 'itens', 'valor_total', 'motivo', 'revertida',
].join(SEPARATOR);

/** Escapa um campo para CSV — aspas duplicadas e o separador neutralizado. */
function csvField(value) {
    if (value === null || value === undefined) return '';
    const text = String(value).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
    return /[";]/.test(text) ? `"${text}"` : text;
}

/** Arquivo mensal — mantém cada CSV em tamanho abrível no Excel. */
function currentFilePath(now) {
    const yyyy = now.getFullYear();
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    return path.join(LOG_DIR, `gipp-fechamento-${yyyy}-${mm}.csv`);
}

/**
 * Acrescenta uma linha por jornada do lote.
 *
 * @param {object} params
 * @param {Array<{cod_work_schedule:string, status:string, items?:number,
 *   details?:Array<{amount:number}>, reason?:string,
 *   reverted_to_payroll_queue?:boolean}>} params.results - Saída de `closeWorkSchedules`.
 * @param {string} params.userId       - Matrícula de quem finalizou.
 * @param {string} params.branchCode   - Filial de quem finalizou.
 */
function appendCloseAudit({ results, userId, branchCode }) {
    try {
        if (!Array.isArray(results) || results.length === 0) return;

        const now  = new Date();
        const data = now.toLocaleDateString('pt-BR');
        const hora = now.toLocaleTimeString('pt-BR', { hour12: false });

        const lines = results.map(r => {
            const total = Array.isArray(r.details)
                ? r.details.reduce((sum, item) => sum + Number(item.amount || 0), 0)
                : null;

            return [
                data,
                hora,
                userId,
                branchCode,
                r.cod_work_schedule,
                r.status,
                r.items ?? '',
                total !== null ? total.toFixed(2).replace('.', ',') : '',
                r.reason ?? '',
                r.reverted_to_payroll_queue === undefined
                    ? ''
                    : (r.reverted_to_payroll_queue ? 'sim' : 'nao'),
            ].map(csvField).join(SEPARATOR);
        });

        fs.mkdirSync(LOG_DIR, { recursive: true });

        const filePath = currentFilePath(now);
        const isNew    = !fs.existsSync(filePath);
        const content  = (isNew ? BOM + HEADER + '\n' : '') + lines.join('\n') + '\n';

        fs.appendFileSync(filePath, content, { encoding: 'utf8' });

    } catch (err) {
        // Só registra no stdout do container. O fechamento não pode falhar por
        // causa do log — a jornada já está com status 4 commitado neste ponto.
        console.error('[gipp:close-audit] Falha ao gravar o CSV de auditoria:', err.message);
    }
}

module.exports = { appendCloseAudit, LOG_DIR };
