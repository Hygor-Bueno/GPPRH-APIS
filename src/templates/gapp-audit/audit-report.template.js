/**
 * @fileoverview Template do relatório de auditoria de ativos (GAPP) em PDF.
 *
 * Mesmo desenho do dossiê do GTPP (`gtpp-dossier/task-dossier.template`): HTML
 * inline para o Puppeteer, cabeçalho e rodapé repetidos em toda página.
 * Recebe o que a API já devolve no detalhe — `getAuditById` (cabeçalho,
 * `initial_data` e conferências) e `getReview` (divergências) — e conta tudo
 * a partir dos ativos, para valer igual em auditoria aberta, finalizada ou
 * cancelada (a cancelada não guarda divergências nem resumos).
 *
 * @module templates/gapp-audit/audit-report.template
 */

'use strict';

const STATUS = ['Aberta', 'Em andamento', 'Finalizada', 'Cancelada'];
const CONDITION = { GOOD: 'Bom', REGULAR: 'Regular', BAD: 'Ruim', UNUSABLE: 'Inutilizável' };
const LIFECYCLE = { IN_USE: 'Em uso', IN_STOCK: 'Em estoque', IN_MAINTENANCE: 'Em manutenção', DISCARDED: 'Descartado' };
const IDENTIFIER = { SERIAL: 'Série', PATRIMONIO: 'Patrimônio' };
const DIVERGENCE = {
    PENDING: 'Pendente', DUPLICATE_IDENTIFIER: 'Identificador repetido', IDENTIFIER_CONFLICT: 'Identificador em outro ativo',
    TRANSFERRED: 'Transferido', UNEXPECTED: 'Não previsto',
};
const FONT = "'Segoe UI',Roboto,Arial,'Liberation Sans','DejaVu Sans',sans-serif";

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ESC[ch]);
const p2 = n => String(n).padStart(2, '0');

/** Date do mysql2 ou texto ISO → "dd/mm/aaaa hh:mm" (hora do processo, como o mysql2 leu). */
function fmtDateTime(value) {
    const date = value instanceof Date ? value : new Date(String(value ?? '').replace(' ', 'T'));
    if (!value || Number.isNaN(date.getTime())) return '—';
    return `${p2(date.getDate())}/${p2(date.getMonth() + 1)}/${date.getFullYear()} ${p2(date.getHours())}:${p2(date.getMinutes())}`;
}

const CSS = `
@page{ size:A4; }
*{ box-sizing:border-box; }
html{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body{ margin:0; font-family:${FONT}; font-size:9pt; line-height:1.4; color:#1A1F24; }
h1{ font-size:18pt; margin:0 0 4px; }
h2{ font-size:11pt; margin:18px 0 6px; padding-bottom:3px; border-bottom:1px solid #C9D1D8; break-after:avoid; }
.meta{ color:#3D4751; font-size:8.5pt; margin:0; }
.cover{ border-bottom:2px solid #1A1F24; padding-bottom:12px; }
.badge{ display:inline-block; border:1px solid #0F4C81; color:#0F4C81; border-radius:4px; padding:1px 8px; font-weight:600; font-size:8pt; }
.kpis{ display:grid; grid-template-columns:repeat(5,1fr); border:1px solid #C9D1D8; border-radius:6px; margin-top:12px; }
.kpi{ padding:6px 10px; border-left:1px solid #C9D1D8; }
.kpi:first-child{ border-left:0; }
.kpi b{ display:block; font-size:14pt; }
.kpi span, .muted{ color:#5A6570; font-size:8pt; }
.chips{ display:flex; flex-wrap:wrap; gap:6px; }
.chip{ border:1px solid #C9D1D8; border-radius:4px; padding:2px 8px; font-size:8.5pt; }
table{ width:100%; border-collapse:collapse; font-size:8pt; }
thead{ display:table-header-group; }
th{ text-align:left; background:#F4F6F8; border-bottom:1px solid #9AA5AF; padding:4px; }
td{ border-bottom:1px solid #E3E8EC; padding:4px; vertical-align:top; overflow-wrap:break-word; }
tr{ break-inside:avoid; }
.warn{ color:#8A5300; font-weight:600; }
`;

/** Ativos da abertura (e não previstos) com a conferência de cada um, em textos prontos. */
function buildRows(audit) {
    const items = new Map((audit.items ?? []).map(item => [Number(item.active_id_fk), item]));
    return (audit.initial_data?.assets ?? []).map(asset => {
        const item = items.get(Number(asset.active_id));
        const transferred = Number(item?.is_transfer) === 1;
        return {
            id: asset.active_id,
            asset: [asset.brand, asset.model].filter(Boolean).join(' ') || '—',
            cls: asset.desc_active_class ?? '—',
            location: asset.dep_path || asset.dep_name || 'Sem setor',
            unexpected: asset.is_expected === false,
            situation: !item ? 'Pendente' : transferred ? 'Transferido' : 'Conferido',
            identifier: item ? `${IDENTIFIER[item.identifier_type] ?? item.identifier_type ?? ''} ${item.identifier_value ?? ''}`.trim() : '—',
            condition: CONDITION[item?.asset_condition] ?? '—',
            lifecycle: LIFECYCLE[item?.lifecycle_status] ?? '—',
            destination: transferred ? (item.transfer_dep_path || item.transfer_dep_name || '—') : '',
        };
    });
}

const countOf = (rows, test) => rows.filter(test).length;

/** Loja do escopo: "Empresa > Filial > Centro de custo" (nome do Protheus; sem nome, o código). */
const scopeLabel = row => [row.company_name || row.company_code, row.branch_name || row.branch_code,
    row.cost_center_code ? (row.cost_center_name || row.cost_center_code) : 'filial inteira'].join(' > ');

/** Prazo: a API já entrega 'AAAA-MM-DD' (DATE, sem fuso) → "dd/mm/aaaa"; vencido marcado. */
function deadlineLabel(audit) {
    if (!audit.date_deadline) return 'Sem prazo';
    const date = String(audit.date_deadline).slice(0, 10).split('-').reverse().join('/');
    return audit.is_overdue ? `${date} (vencido)` : date;
}

function renderCover(audit) {
    const cls = audit.desc_active_class || 'Todas as classes';
    const scope = (audit.scope ?? []).map(scopeLabel).join('; ') || 'Não informado';
    const closed = audit.date_finish ? ` · encerrada em ${fmtDateTime(audit.date_finish)} por ${audit.user_finish_name ?? '—'}` : '';
    return `<section class="cover">
<p class="meta">GAPP · Relatório da auditoria nº ${esc(audit.audit_id)}</p>
<h1>${esc(audit.audit_name || `Auditoria nº ${audit.audit_id}`)} <span class="badge">${esc(STATUS[audit.status_audit] ?? '—')}</span></h1>
<p class="meta"><b>Escopo:</b> ${esc(scope)}</p>
<p class="meta"><b>Classe:</b> ${esc(cls)} · <b>Prazo:</b> ${esc(deadlineLabel(audit))}</p>
<p class="meta">Aberta em ${esc(fmtDateTime(audit.date_open))} por ${esc(audit.user_open_name ?? '—')}${esc(closed)}</p>
</section>`;
}

function renderKpis(rows) {
    const kpis = [
        ['Previstos', countOf(rows, row => !row.unexpected)],
        ['Conferidos', countOf(rows, row => row.situation !== 'Pendente')],
        ['Pendentes', countOf(rows, row => row.situation === 'Pendente')],
        ['Transferidos', countOf(rows, row => row.situation === 'Transferido')],
        ['Não previstos', countOf(rows, row => row.unexpected)],
    ];
    return `<div class="kpis">${kpis.map(([label, value]) => `<div class="kpi"><b>${value}</b><span>${label}</span></div>`).join('')}</div>`;
}

/** Conservação e ciclo de vida dos conferidos, contados por rótulo. */
function renderSummary(rows) {
    const checked = rows.filter(row => row.situation !== 'Pendente');
    const chips = labels => Object.values(labels)
        .map(label => `<span class="chip">${esc(label)}: <b>${countOf(checked, row => row.condition === label || row.lifecycle === label)}</b></span>`).join('');
    return `<h2>Resumo dos conferidos</h2>
<p class="muted">Estado de conservação</p><div class="chips">${chips(CONDITION)}</div>
<p class="muted" style="margin-top:6px">Ciclo de vida</p><div class="chips">${chips(LIFECYCLE)}</div>`;
}

function divergenceAssets(divergence) {
    const ids = divergence.active_ids ?? (divergence.active_id != null ? [divergence.active_id] : []);
    return ids.map(id => `#${id}`).join(', ') || '—';
}

function renderDivergences(review) {
    if (review?.canceled) return `<h2>Cancelamento</h2><p>${esc(review.reason || 'Sem motivo informado.')}</p>`;
    const list = review?.divergences ?? [];
    if (!list.length) return '<h2>Divergências</h2><p class="muted">Nenhuma divergência.</p>';
    const body = list.map(divergence => `<tr><td>${esc(DIVERGENCE[divergence.type] ?? divergence.type)}</td>
<td>${esc(divergenceAssets(divergence))}</td><td>${esc(divergence.message)}</td></tr>`).join('');
    return `<h2>Divergências (${list.length})</h2>
<table><thead><tr><th style="width:24%">Tipo</th><th style="width:16%">Ativo(s)</th><th>Descrição</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderAssetRow(row) {
    const situation = row.situation === 'Pendente' ? `<span class="warn">${row.situation}</span>` : row.situation;
    const destination = row.destination ? `<br><span class="muted">→ ${esc(row.destination)}</span>` : '';
    return `<tr><td>#${esc(row.id)}</td><td>${esc(row.asset)}${row.unexpected ? '<br><span class="muted">não previsto</span>' : ''}</td>
<td>${esc(row.cls)}</td><td>${esc(row.location)}</td><td>${situation}${destination}</td>
<td>${esc(row.identifier)}</td><td>${esc(row.condition)}</td><td>${esc(row.lifecycle)}</td></tr>`;
}

function renderAssets(rows) {
    if (!rows.length) return '<h2>Ativos</h2><p class="muted">Nenhum ativo na auditoria.</p>';
    return `<h2>Ativos (${rows.length})</h2>
<table><thead><tr><th>Código</th><th>Ativo</th><th>Classe</th><th>Local na abertura</th><th>Situação</th>
<th>Identificador</th><th>Conservação</th><th>Ciclo de vida</th></tr></thead>
<tbody>${rows.map(renderAssetRow).join('')}</tbody></table>`;
}

/**
 * @param {{ audit: object, review: object }} report
 * @returns {string} HTML completo
 */
function renderAuditReportHtml({ audit, review }) {
    const rows = buildRows(audit);
    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório da auditoria nº ${esc(audit.audit_id)}</title><style>${CSS}</style></head>
<body><main>
${renderCover(audit)}
${renderKpis(rows)}
${renderSummary(rows)}
${renderDivergences(review)}
${renderAssets(rows)}
</main></body></html>`;
}

/** headerTemplate do Puppeteer: estilos inline e tamanhos explícitos (o padrão do Chrome é minúsculo). */
function buildAuditReportHeader({ auditId }) {
    return `<div style="box-sizing:border-box;width:100%;padding:0 14mm;font-family:${FONT};font-size:8pt;color:#3D4751;">
  <div style="display:flex;justify-content:space-between;border-bottom:0.5pt solid #9AA5AF;padding-bottom:2mm;">
    <span><b style="color:#0F4C81;">Peg Pese</b> · GAPP · Relatório de auditoria</span><b style="color:#1A1F24;">Nº ${esc(auditId)}</b>
  </div>
</div>`;
}

function buildAuditReportFooter({ generatedAt, generatedByName }) {
    return `<div style="box-sizing:border-box;width:100%;padding:0 14mm;font-family:${FONT};font-size:7.5pt;color:#5A6570;">
  <div style="display:flex;justify-content:space-between;border-top:0.5pt solid #9AA5AF;padding-top:2mm;">
    <span>Gerado em ${esc(fmtDateTime(generatedAt))} por ${esc(generatedByName || '—')} · Documento interno</span>
    <span style="color:#1A1F24;">Página <b class="pageNumber"></b> de <span class="totalPages"></span></span>
  </div>
</div>`;
}

module.exports = { renderAuditReportHtml, buildAuditReportHeader, buildAuditReportFooter, _internals: { buildRows, esc, fmtDateTime } };
