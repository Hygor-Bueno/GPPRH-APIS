'use strict';
/**
 * GTPP — Dossiê da Tarefa (template de PDF)
 *
 * renderTaskDossierHtml(dossier) => string   (HTML completo, autocontido)
 * buildPdfHeaderTemplate(opts)   => string   (headerTemplate do Puppeteer)
 * buildPdfFooterTemplate(opts)   => string   (footerTemplate do Puppeteer)
 *
 * Funções puras: sem I/O, sem banco, sem dependências. Todo texto vindo do
 * usuário passa por esc(); cores, data URIs e links passam por validação
 * antes de entrar em atributos.
 *
 * Links (opcionais): `task.url`, `items[].url` e `url` de cada anexo apontam
 * para a tela do GTPP, que exige login — o PDF nunca carrega acesso direto ao
 * arquivo. Sem `url`, o documento sai igual, só com as referências A1, A2…
 */

/* ------------------------------------------------------------------ */
/* Constantes e limites                                                */
/* ------------------------------------------------------------------ */

const LIMITS = Object.freeze({
  CHAT_MAX_MESSAGES: 200,     // mensagens mais recentes exibidas no anexo de chat
  CHAT_TEXT_MAX: 1200,        // caracteres por mensagem de chat
  COMMENT_TEXT_MAX: 3000,     // caracteres por comentário
  NOTE_MAX: 3000,             // caracteres por observação de item
  DESCRIPTION_MAX: 20000,     // caracteres da descrição da tarefa
  ITEM_DESC_MAX: 1000,        // caracteres da descrição de um item
  ATTENTION_REFS_MAX: 12,     // referências listadas por ponto de atenção
  HEADER_TITLE_MAX: 70,       // título no cabeçalho repetido
  PROGRESS_GAP_WARN: 20,      // pontos percentuais: tempo decorrido − progresso
  DEADLINE_NEAR_DAYS: 2,      // "prazo vence em até N dias"
  ITEM_DEADLINE_NEAR_PCT: 80, // deadline_percent a partir do qual o item está "perto de vencer"
  MAX_EMBEDDED_THUMBS: 300,   // miniaturas de imagem embutidas no documento (o resto vira bloco "ver índice")
});

const TASK_STATES = Object.freeze({
  1: 'A fazer', 2: 'Fazendo', 3: 'Em validação', 4: 'Parado',
  5: 'Vencido', 6: 'Concluído', 7: 'Cancelado', 8: 'Arquivado',
});
const CLOSED_STATES = new Set([6, 7, 8]);

const PRIORITIES = Object.freeze({
  0: { label: 'Baixa', bars: 1 },
  1: { label: 'Média', bars: 2 },
  2: { label: 'Alta', bars: 3 },
});

const ATTACHMENT_TYPES = Object.freeze({
  image: 'Imagem', video: 'Vídeo', pdf: 'PDF', other: 'Arquivo',
});

const PROCESSING_LABELS = Object.freeze({
  ready: 'Disponível', pending: 'Aguardando processamento',
  processing: 'Em processamento', failed: 'Falha no processamento',
});

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado'];

/* ------------------------------------------------------------------ */
/* Utilitários seguros                                                 */
/* ------------------------------------------------------------------ */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

function clip(value, max) {
  const s = value === null || value === undefined ? '' : String(value);
  if (s.length <= max) return { text: s, cut: false };
  return { text: s.slice(0, max).trimEnd() + '…', cut: true };
}

/** Texto multilinha do usuário: escapado, quebras preservadas via CSS (pre-wrap). */
function richText(value, max, cutNotice) {
  const c = clip(value, max);
  return esc(c.text) + (c.cut ? ` <span class="cut-note">${esc(cutNotice || '(texto truncado)')}</span>` : '');
}

function safeColor(c) {
  return typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : '#8A94A0';
}

const DATA_IMG_RE = /^data:image\/(jpeg|jpg|png|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\r\n]+$/;
function safeImg(uri) {
  return typeof uri === 'string' && DATA_IMG_RE.test(uri) ? uri : null;
}

function int(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

/** Só links http(s) entram no PDF; qualquer outra coisa vira texto sem link. */
function safeUrl(u) {
  return typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

/** Envolve `inner` (HTML já escapado) num link para o GTPP, quando houver URL válida. */
function linkTo(url, inner, cls = 'lnk') {
  const href = safeUrl(url);
  return href ? `<a class="${cls}" href="${esc(href)}">${inner}</a>` : inner;
}

/* Datas: parse manual, sem fuso — o backend já entrega horário local. */
function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || ''));
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null };
}
const p2 = (n) => String(n).padStart(2, '0');
function fmtDate(s) { const p = parseIso(s); return p ? `${p2(p.d)}/${p2(p.mo)}/${p.y}` : '—'; }
function fmtDateShort(s) { const p = parseIso(s); return p ? `${p2(p.d)}/${p2(p.mo)}/${String(p.y).slice(2)}` : '—'; }
function fmtTime(s) { const p = parseIso(s); return p && p.h !== null ? `${p2(p.h)}:${p2(p.mi)}` : ''; }
function fmtDateTime(s) {
  const p = parseIso(s); if (!p) return '—';
  return p.h !== null ? `${fmtDate(s)} ${fmtTime(s)}` : fmtDate(s);
}
function dayNumber(s) { const p = parseIso(s); return p ? Date.UTC(p.y, p.mo - 1, p.d) / 864e5 : null; }
function dayKey(s) { const p = parseIso(s); return p ? `${p.y}-${p2(p.mo)}-${p2(p.d)}` : ''; }
function weekday(s) { const n = dayNumber(s); return n === null ? '' : WEEKDAYS[new Date(n * 864e5).getUTCDay()]; }
function sortKey(s) { return String(s || ''); }

function fmtSize(bytes) {
  const b = int(bytes, -1);
  if (b < 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]/i.test(w));
  const a = (parts[0] || '?')[0];
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

function pad2(n) { return String(n).padStart(2, '0'); }

/* ------------------------------------------------------------------ */
/* Ícones (SVG inline, herdam a cor do texto — legíveis em P&B)        */
/* ------------------------------------------------------------------ */

const ICON_PATHS = {
  check: '<path d="M4 12.5l5 5L20 6.5" />',
  x: '<path d="M6 6l12 12M18 6L6 18" />',
  question: '<path d="M9 9.2a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1-1.2 1.8v.7" /><circle cx="12" cy="18" r=".6" fill="currentColor" />',
  clock: '<circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />',
  alert: '<path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.3" r=".6" fill="currentColor" />',
  octagon: '<path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z" /><path d="M12 7.5v5.5" /><circle cx="12" cy="16.5" r=".6" fill="currentColor" />',
  info: '<circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r=".6" fill="currentColor" />',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="1.5" /><path d="M3.5 9.5h17M8 3v4M16 3v4" />',
  user: '<circle cx="12" cy="8" r="3.8" /><path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6" />',
  userOff: '<circle cx="12" cy="8" r="3.8" /><path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6" /><path d="M3 3l18 18" />',
  clip: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />',
  comment: '<path d="M4 5h16v11H9l-5 4z" />',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><circle cx="9" cy="9.5" r="1.6" /><path d="M20.5 16l-5-5-8 8.5" />',
  video: '<rect x="3" y="6" width="13" height="12" rx="1.5" /><path d="M16 10.5l5-3v9l-5-3z" />',
  pdf: '<path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 16.5h6" />',
  file: '<path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" />',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5" />',
  list: '<path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" />',
  chat: '<path d="M4 5h16v11H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" />',
  people: '<circle cx="9" cy="8.5" r="3.3" /><path d="M2.8 20c.8-3.5 3.3-5.3 6.2-5.3s5.4 1.8 6.2 5.3" /><path d="M15.5 5.3a3.3 3.3 0 0 1 0 6.4M17.5 14.9c2 .6 3.3 2.3 3.8 5.1" />',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v4.5H8" /><path d="M12 8v4.3l3 1.8" />',
  doc: '<path d="M6 3h8l4 4v14H6z" /><path d="M9 11h6M9 14.5h6M9 18h4" />',
  ban: '<circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" />',
  external: '<path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />',
};

function icon(name, cls = '') {
  const body = ICON_PATHS[name] || ICON_PATHS.info;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function priorityIcon(bars) {
  const rects = [0, 1, 2].map((i) => {
    const h = 6 + i * 5; const x = 4 + i * 6; const y = 20 - h;
    const on = i < bars;
    return `<rect x="${x}" y="${y}" width="4" height="${h}" rx=".8" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6"/>`;
  }).join('');
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${rects}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Regras derivadas                                                    */
/* ------------------------------------------------------------------ */

const CONCLUDED_ITEM = new Set(['done', 'answered_yes', 'answered_no']);

/** Mapeamento de status de item → rótulo, ícone e tom (tom = cor + padrão de borda). */
function itemStatusView(it) {
  const st = it.status;
  const overdue = !!it.overdue && !CONCLUDED_ITEM.has(st);
  if (st === 'done') return { key: 'done', label: 'Concluído', icon: 'check', tone: 'ok' };
  if (st === 'answered_yes') return { key: 'yes', label: 'Resposta: Sim', icon: 'check', tone: 'answer' };
  if (st === 'answered_no') return { key: 'no', label: 'Resposta: Não', icon: 'x', tone: 'answer' };
  if (st === 'unanswered') {
    return overdue
      ? { key: 'unanswered-overdue', label: 'Sem resposta · vencido', icon: 'alert', tone: 'danger' }
      : { key: 'unanswered', label: 'Sem resposta', icon: 'question', tone: 'warn' };
  }
  return overdue
    ? { key: 'overdue', label: 'Vencido', icon: 'alert', tone: 'danger' }
    : { key: 'pending', label: 'Pendente', icon: 'clock', tone: 'neutral' };
}

function attachmentTypeKey(t) { return ATTACHMENT_TYPES[t] ? t : 'other'; }
function attachmentIcon(t) {
  return { image: 'image', video: 'video', pdf: 'pdf' }[attachmentTypeKey(t)] || 'file';
}

/**
 * Numera todos os anexos (A1, A2, …) na ordem de leitura do documento:
 * item → anexo do item → anexos dos comentários; depois chat.
 */
function buildAttachmentRegistry(items, messages) {
  const list = [];
  let thumbs = 0;
  let omitted = 0;
  const push = (att, origin) => {
    if (!att || typeof att !== 'object') return null;
    let thumb = safeImg(att.thumb);
    if (thumb && origin.kind !== 'chat') {
      if (thumbs >= LIMITS.MAX_EMBEDDED_THUMBS) { thumb = null; omitted += 1; } else thumbs += 1;
    } else if (origin.kind === 'chat') thumb = null;
    const entry = {
      ref: `A${list.length + 1}`,
      name: att.name || 'sem nome',
      type: attachmentTypeKey(att.type),
      size: att.size,
      thumb,
      status: PROCESSING_LABELS[att.processing_status] ? att.processing_status : 'ready',
      url: safeUrl(att.url),
      origin,
    };
    list.push(entry);
    return entry;
  };
  const byItem = new Map(); // order → { own, comments: [[entries]] }
  for (const it of items) {
    const own = push(it.attachment, { kind: 'item', order: it.order });
    const comments = (it.comments || []).map((c) =>
      (c.attachments || []).map((a) => push(a, { kind: 'comment', order: it.order, author: c.author, created_at: c.created_at })).filter(Boolean));
    byItem.set(it, { own, comments });
  }
  const byMessage = new Map();
  for (const m of messages) {
    const e = push(m.attachment, { kind: 'chat', author: m.author, created_at: m.created_at });
    if (e) byMessage.set(m, e);
  }
  return { list, byItem, byMessage, omittedThumbs: omitted };
}

function computeStats(d, items, registry) {
  const s = {
    total: items.length, concluded: 0, overdue: [], unanswered: [], unassigned: [],
    inactiveAssignee: [], nearDeadline: [], questions: 0,
    evidence: registry.list.filter((a) => a.origin.kind !== 'chat').length,
    failed: registry.list.filter((a) => a.status === 'failed'),
    processing: registry.list.filter((a) => a.status === 'pending' || a.status === 'processing'),
  };
  const inactiveIds = new Set((d.participants || []).filter((p) => p && p.active === false).map((p) => p.id));
  for (const it of items) {
    const done = CONCLUDED_ITEM.has(it.status);
    if (it.type === 'question') s.questions += 1;
    if (done) { s.concluded += 1; continue; }
    if (it.overdue) s.overdue.push(it.order);
    if (it.status === 'unanswered') s.unanswered.push(it.order);
    if (!it.assigned_to) s.unassigned.push(it.order);
    else if (inactiveIds.has(it.assigned_to.id)) s.inactiveAssignee.push(it.order);
    if (!it.overdue && int(it.deadline_percent, 0) >= LIMITS.ITEM_DEADLINE_NEAR_PCT) s.nearDeadline.push(it.order);
  }
  return s;
}

/** % do período da tarefa já decorrido na data de geração (null se datas inválidas). */
function elapsedPercent(task, generatedAt) {
  const a = dayNumber(task.initial_date); const b = dayNumber(task.final_date); const g = dayNumber(generatedAt);
  if (a === null || b === null || g === null || b < a) return null;
  const span = b - a + 1;
  return Math.max(0, Math.round(((g - a + 1) / span) * 100));
}

function refList(orders, prefix = 'Item') {
  const max = LIMITS.ATTENTION_REFS_MAX;
  const shown = orders.slice(0, max).map((o) => pad2(o)).join(', ');
  const extra = orders.length > max ? ` e mais ${orders.length - max}` : '';
  return `${orders.length === 1 ? prefix : prefix + 's'} ${shown}${extra}`;
}

/** Pontos de atenção — ordenados por severidade (critical → warning → info). */
function computeAttention(d, task, stats, elapsed) {
  const out = [];
  const stateId = int(task.state && task.state.id, 0);
  const closed = CLOSED_STATES.has(stateId);
  const days = int(task.days_to_deadline, 0);
  const pct = Math.max(0, Math.min(100, int(task.percent, 0)));

  if (!closed && days < 0) {
    out.push({ level: 'critical', title: `Tarefa atrasada há ${plural(-days, 'dia', 'dias')}`,
      detail: `O prazo final era ${fmtDate(task.final_date)}; progresso atual de ${pct}%.` });
  }
  if (task.disqualified) {
    out.push({ level: 'critical', title: 'Tarefa marcada como desqualificada', detail: 'Verifique o motivo no histórico ou no chat da tarefa.' });
  }
  if (stats.overdue.length) {
    out.push({ level: 'critical', title: `${plural(stats.overdue.length, 'item vencido', 'itens vencidos')} sem conclusão`,
      detail: refList(stats.overdue) + '.' });
  }
  if (!closed && days >= 0 && days <= LIMITS.DEADLINE_NEAR_DAYS && pct < 100) {
    out.push({ level: 'warning', title: days === 0 ? 'Prazo da tarefa vence hoje' : `Prazo da tarefa vence em ${plural(days, 'dia', 'dias')}`,
      detail: `Progresso atual de ${pct}%.` });
  }
  if (!closed && elapsed !== null && elapsed - pct >= LIMITS.PROGRESS_GAP_WARN) {
    out.push({ level: 'warning', title: 'Progresso abaixo do tempo decorrido',
      detail: `${Math.min(elapsed, 100)}% do prazo já passou e a tarefa está em ${pct}%.` });
  }
  if (stats.unanswered.length) {
    out.push({ level: 'warning', title: `${plural(stats.unanswered.length, 'pergunta sem resposta', 'perguntas sem resposta')}`,
      detail: refList(stats.unanswered) + '.' });
  }
  if (stats.unassigned.length) {
    out.push({ level: 'warning', title: `${plural(stats.unassigned.length, 'item pendente', 'itens pendentes')} sem responsável`,
      detail: refList(stats.unassigned) + '.' });
  }
  if (stats.inactiveAssignee.length) {
    out.push({ level: 'warning', title: 'Itens pendentes atribuídos a participante inativo',
      detail: refList(stats.inactiveAssignee) + '.' });
  }
  if (stats.failed.length) {
    const videos = stats.failed.filter((a) => a.type === 'video').length;
    out.push({ level: 'warning',
      title: videos === stats.failed.length
        ? `${plural(videos, 'vídeo', 'vídeos')} com falha no processamento`
        : `${plural(stats.failed.length, 'anexo', 'anexos')} com falha no processamento`,
      detail: `Evidência indisponível: ${stats.failed.slice(0, LIMITS.ATTENTION_REFS_MAX).map((a) => a.ref).join(', ')}${stats.failed.length > LIMITS.ATTENTION_REFS_MAX ? '…' : ''}. Peça o reenvio.` });
  }
  if (stats.nearDeadline.length) {
    out.push({ level: 'info', title: `${plural(stats.nearDeadline.length, 'item perto', 'itens perto')} do vencimento`,
      detail: refList(stats.nearDeadline) + ` (≥ ${LIMITS.ITEM_DEADLINE_NEAR_PCT}% do prazo do item decorrido).` });
  }
  if (stats.processing.length) {
    out.push({ level: 'info', title: `${plural(stats.processing.length, 'anexo ainda', 'anexos ainda')} em processamento`,
      detail: `${stats.processing.slice(0, LIMITS.ATTENTION_REFS_MAX).map((a) => a.ref).join(', ')} — podem não ter miniatura neste documento.` });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* CSS (tokens em :root)                                               */
/* ------------------------------------------------------------------ */

const CSS = `
:root{
  --font-sans:"Segoe UI",Roboto,"Helvetica Neue",Arial,"Liberation Sans","DejaVu Sans",sans-serif;
  --fs-xs:8pt; --fs-sm:8.5pt; --fs-base:9.5pt; --fs-md:11pt; --fs-lg:13pt; --fs-xl:19pt;
  --lh-tight:1.25; --lh-base:1.45;
  --sp-1:2px; --sp-2:4px; --sp-3:6px; --sp-4:8px; --sp-5:12px; --sp-6:16px; --sp-7:24px; --sp-8:32px;
  --radius:4px; --radius-lg:6px;
  --c-ink:#1A1F24; --c-ink-2:#3D4751; --c-muted:#5A6570; --c-line:#C9D1D8; --c-line-soft:#E3E8EC;
  --c-surface:#FFFFFF; --c-surface-2:#F4F6F8; --c-brand:#0F4C81;
  --c-ok:#1B7A3A; --c-ok-bg:#E8F4EC;
  --c-answer:#1D5FA8; --c-answer-bg:#E8F0FA;
  --c-warn:#8A5300; --c-warn-bg:#FFF3DC;
  --c-danger:#B42318; --c-danger-bg:#FDECEA;
  --c-neutral:#4A5560; --c-neutral-bg:#F1F3F5;
  --c-info:#1D5FA8; --c-info-bg:#E8F0FA;
}
@page{ size:A4; margin:24mm 14mm 18mm 14mm; }
*{ box-sizing:border-box; }
html{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body{ margin:0; font-family:var(--font-sans); font-size:var(--fs-base); line-height:var(--lh-base); color:var(--c-ink); background:var(--c-surface); }
p{ margin:0; }
.ic{ width:1.1em; height:1.1em; vertical-align:-0.18em; flex:none; }
.muted{ color:var(--c-muted); }
.num{ font-variant-numeric:tabular-nums; }
.pre{ white-space:pre-wrap; overflow-wrap:anywhere; }
.wrap{ overflow-wrap:anywhere; }
.nowrap{ white-space:nowrap; overflow-wrap:normal !important; }
.cut-note{ color:var(--c-muted); font-style:italic; font-size:var(--fs-xs); white-space:nowrap; }
a.lnk{ color:inherit; text-decoration:none; }
a.lnk-text{ color:var(--c-brand); text-decoration:underline; text-decoration-thickness:.5pt; text-underline-offset:1.5pt; }
a.lnk-text .ic{ width:.9em; height:.9em; margin-left:var(--sp-1); }
.open-link{ display:inline-flex; align-items:center; gap:var(--sp-2); font-size:var(--fs-sm); font-weight:600; margin-top:var(--sp-3); }

/* ---------- Capa ---------- */
.cover{ border-bottom:2px solid var(--c-ink); padding-bottom:var(--sp-6); margin-bottom:var(--sp-6); }
.brand{ display:flex; align-items:center; justify-content:space-between; gap:var(--sp-5); margin-bottom:var(--sp-5); }
.brand img{ height:28px; width:auto; }
.brand-name{ font-weight:700; font-size:var(--fs-md); color:var(--c-brand); }
.eyebrow{ font-size:var(--fs-xs); font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--c-muted); }
h1{ font-size:var(--fs-xl); line-height:var(--lh-tight); margin:var(--sp-2) 0 var(--sp-3); overflow-wrap:anywhere; }
.cover-meta{ color:var(--c-ink-2); font-size:var(--fs-sm); }
.chips{ display:flex; flex-wrap:wrap; gap:var(--sp-3); margin:var(--sp-5) 0; }
.chip{ display:inline-flex; align-items:center; gap:var(--sp-3); border:1px solid var(--c-line); border-radius:var(--radius); padding:var(--sp-2) var(--sp-4); font-size:var(--fs-sm); font-weight:600; }
.chip .k{ font-weight:400; color:var(--c-muted); }
.swatch{ width:10px; height:10px; border-radius:50%; border:1px solid rgba(0,0,0,.35); display:inline-block; flex:none; }
.chip.danger{ border:2px solid var(--c-danger); color:var(--c-danger); background:var(--c-danger-bg); }
.chip.warn{ border:1px dashed var(--c-warn); color:var(--c-warn); background:var(--c-warn-bg); }
.banner{ display:flex; gap:var(--sp-4); align-items:center; border:2px solid var(--c-danger); background:var(--c-danger-bg); color:var(--c-danger); font-weight:700; padding:var(--sp-4) var(--sp-5); border-radius:var(--radius); margin-bottom:var(--sp-5); }

.bars{ display:grid; grid-template-columns:34mm 1fr 14mm; gap:var(--sp-3) var(--sp-4); align-items:center; margin:var(--sp-5) 0 var(--sp-3); }
.bar-label{ font-size:var(--fs-sm); color:var(--c-ink-2); }
.bar-val{ text-align:right; font-weight:700; font-variant-numeric:tabular-nums; }
.track{ height:10px; border:1px solid var(--c-ink-2); border-radius:2px; background:var(--c-surface); overflow:hidden; }
.fill{ height:100%; background:var(--c-brand); }
.fill.time{ background:repeating-linear-gradient(135deg, var(--c-neutral) 0 2px, transparent 2px 5px); }
.bar-hint{ font-size:var(--fs-xs); color:var(--c-muted); }

.kpis{ display:grid; grid-template-columns:repeat(5,1fr); border:1px solid var(--c-line); border-radius:var(--radius-lg); margin-top:var(--sp-5); }
.kpi{ padding:var(--sp-4) var(--sp-5); border-left:1px solid var(--c-line); }
.kpi:first-child{ border-left:0; }
.kpi-label{ font-size:var(--fs-xs); color:var(--c-muted); display:flex; gap:var(--sp-2); align-items:center; }
.kpi-value{ font-size:var(--fs-lg); font-weight:700; font-variant-numeric:tabular-nums; line-height:1.2; margin-top:var(--sp-1); }
.kpi-value small{ font-size:var(--fs-sm); font-weight:400; color:var(--c-muted); }
.kpi.alert .kpi-value{ color:var(--c-danger); }
.kpi.alert .kpi-value::before{ content:"! "; }
.kpi.zero .kpi-value{ color:var(--c-muted); font-weight:400; }

/* ---------- Seções ---------- */
.sec{ margin-top:var(--sp-7); }
.sec-title{ display:flex; align-items:center; gap:var(--sp-4); font-size:var(--fs-lg); margin:0 0 var(--sp-5); padding-bottom:var(--sp-3); border-bottom:1px solid var(--c-ink); break-after:avoid; page-break-after:avoid; }
.sec-title .n{ font-size:var(--fs-sm); color:var(--c-surface); background:var(--c-ink); border-radius:2px; padding:0 var(--sp-3); font-variant-numeric:tabular-nums; }
.sec-title .count{ margin-left:auto; font-size:var(--fs-sm); font-weight:400; color:var(--c-muted); }
.sub-title{ font-size:var(--fs-md); margin:var(--sp-6) 0 var(--sp-4); break-after:avoid; page-break-after:avoid; }
.sec-title + *, .sub-title + *{ break-before:avoid; }
.lead{ font-size:var(--fs-sm); color:var(--c-muted); margin:calc(-1 * var(--sp-3)) 0 var(--sp-4); break-after:avoid; page-break-after:avoid; }
.page-break{ break-before:page; page-break-before:always; }

.empty{ display:flex; gap:var(--sp-4); align-items:center; border:1px dashed var(--c-line); border-radius:var(--radius); padding:var(--sp-4) var(--sp-5); color:var(--c-muted); font-size:var(--fs-sm); background:var(--c-surface-2); break-inside:avoid; }

/* ---------- Pontos de atenção ---------- */
.att{ list-style:none; margin:0; padding:0; border:1px solid var(--c-line); border-radius:var(--radius-lg); }
.att li{ display:grid; grid-template-columns:24mm 1fr; gap:var(--sp-5); padding:var(--sp-4) var(--sp-5); border-top:1px solid var(--c-line-soft); break-inside:avoid; }
.att li:first-child{ border-top:0; }
.lvl{ display:inline-flex; align-items:center; gap:var(--sp-2); font-size:var(--fs-xs); font-weight:700; letter-spacing:.05em; text-transform:uppercase; padding:var(--sp-1) var(--sp-3); border-radius:var(--radius); align-self:start; justify-self:start; }
.lvl.critical{ background:var(--c-danger); color:#fff; }
.lvl.warning{ border:1px dashed var(--c-warn); color:var(--c-warn); background:var(--c-warn-bg); }
.lvl.info{ border:1px solid var(--c-info); color:var(--c-info); }
.att-title{ font-weight:700; }
.att-detail{ font-size:var(--fs-sm); color:var(--c-ink-2); overflow-wrap:anywhere; }

/* ---------- Participantes / escopo ---------- */
.people{ display:grid; grid-template-columns:repeat(3,1fr); gap:var(--sp-3) var(--sp-5); }
.person{ display:flex; align-items:center; gap:var(--sp-4); min-width:0; break-inside:avoid; }
.avatar{ width:26px; height:26px; border-radius:50%; flex:none; object-fit:cover; border:1px solid var(--c-line); }
.avatar.ini{ display:inline-flex; align-items:center; justify-content:center; background:var(--c-surface-2); color:var(--c-ink-2); font-size:var(--fs-xs); font-weight:700; }
.person-name{ font-size:var(--fs-sm); font-weight:600; overflow-wrap:anywhere; line-height:var(--lh-tight); }
.person.inactive .person-name{ color:var(--c-muted); text-decoration:line-through; }
.tag{ display:inline-block; font-size:var(--fs-xs); font-weight:600; border:1px solid var(--c-line); border-radius:2px; padding:0 var(--sp-2); color:var(--c-ink-2); margin-right:var(--sp-2); }
.tag.dashed{ border-style:dashed; }
.desc-box{ border-left:3px solid var(--c-line); padding:var(--sp-2) 0 var(--sp-2) var(--sp-5); }

/* ---------- Tabelas ---------- */
table{ width:100%; border-collapse:collapse; font-size:var(--fs-sm); }
thead{ display:table-header-group; }
th{ text-align:left; font-size:var(--fs-xs); font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--c-ink-2); border-bottom:1.5px solid var(--c-ink); padding:var(--sp-3) var(--sp-3); vertical-align:bottom; }
td{ padding:var(--sp-3); border-bottom:1px solid var(--c-line-soft); vertical-align:top; overflow-wrap:anywhere; }
tr{ break-inside:avoid; page-break-inside:avoid; }
tbody tr:nth-child(even) td{ background:var(--c-surface-2); }
td.c, th.c{ text-align:center; }
td.r, th.r{ text-align:right; }
tr.row-danger td:first-child{ box-shadow:inset 3px 0 0 var(--c-danger); }
.st{ display:inline-flex; align-items:center; gap:var(--sp-2); font-weight:600; white-space:nowrap; }
.st.ok{ color:var(--c-ok); } .st.answer{ color:var(--c-answer); } .st.warn{ color:var(--c-warn); }
.st.danger{ color:var(--c-danger); } .st.neutral{ color:var(--c-neutral); }
.counts{ white-space:nowrap; color:var(--c-ink-2); }
.counts span{ margin-right:var(--sp-3); }
.type-q{ font-size:var(--fs-xs); font-weight:700; color:var(--c-ink-2); border:1px solid var(--c-line); border-radius:2px; padding:0 var(--sp-2); margin-right:var(--sp-2); white-space:nowrap; }

/* ---------- Cartões de item ---------- */
.card{ border:1px solid var(--c-line); border-left-width:5px; border-radius:var(--radius); margin-bottom:var(--sp-5); background:var(--c-surface); }
.card.ok{ border-left:5px solid var(--c-ok); }
.card.answer{ border-left:5px solid var(--c-answer); }
.card.warn{ border-left:5px dashed var(--c-warn); }
.card.danger{ border-left:6px double var(--c-danger); }
.card.neutral{ border-left:5px dotted var(--c-neutral); }
.card.small{ break-inside:avoid; page-break-inside:avoid; }
.card-head{ display:grid; grid-template-columns:1fr auto; gap:var(--sp-5); padding:var(--sp-4) var(--sp-5); border-bottom:1px solid var(--c-line-soft); break-inside:avoid; break-after:avoid; }
.card-title{ font-weight:700; font-size:var(--fs-base); overflow-wrap:anywhere; line-height:var(--lh-tight); margin-top:var(--sp-1); }
.badge{ display:inline-flex; align-items:center; gap:var(--sp-2); font-size:var(--fs-sm); font-weight:700; padding:var(--sp-2) var(--sp-4); border-radius:var(--radius); white-space:nowrap; align-self:start; }
.badge.ok{ background:var(--c-ok); color:#fff; }
.badge.answer{ background:var(--c-answer); color:#fff; }
.badge.danger{ background:var(--c-danger); color:#fff; }
.badge.warn{ border:1.5px dashed var(--c-warn); color:var(--c-warn); background:var(--c-warn-bg); }
.badge.neutral{ border:1.5px solid var(--c-neutral); color:var(--c-neutral); }
.meta{ display:flex; flex-wrap:wrap; gap:var(--sp-2) var(--sp-6); font-size:var(--fs-sm); color:var(--c-ink-2); margin-top:var(--sp-3); }
.meta .warn-text{ color:var(--c-danger); font-weight:700; }
.card-body{ padding:var(--sp-4) var(--sp-5); }
.block-label{ font-size:var(--fs-xs); font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--c-muted); margin:var(--sp-4) 0 var(--sp-2); break-after:avoid; display:flex; gap:var(--sp-2); align-items:center; }
.block-label:first-child{ margin-top:0; }
.note{ background:var(--c-surface-2); border-left:3px solid var(--c-ink-2); padding:var(--sp-3) var(--sp-4); font-size:var(--fs-sm); }
.comments{ list-style:none; margin:0; padding:0; }
.comment{ border-left:2px solid var(--c-line); padding:var(--sp-2) 0 var(--sp-2) var(--sp-5); margin-top:var(--sp-4); break-inside:avoid; page-break-inside:avoid; }
.comment-head{ font-size:var(--fs-sm); }
.comment-head b{ overflow-wrap:anywhere; }
.comment-text{ font-size:var(--fs-sm); margin-top:var(--sp-1); }

.thumbs{ display:grid; grid-template-columns:repeat(5,1fr); gap:var(--sp-4); margin-top:var(--sp-3); }
.thumb{ min-width:0; break-inside:avoid; }
.thumb-img{ width:100%; aspect-ratio:4/3; object-fit:cover; border:1px solid var(--c-line); border-radius:2px; display:block; background:var(--c-surface-2); }
.thumb-tile{ width:100%; aspect-ratio:4/3; border:1px solid var(--c-line); border-radius:2px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--sp-2); background:var(--c-surface-2); color:var(--c-ink-2); font-size:var(--fs-xs); font-weight:700; text-align:center; padding:var(--sp-2); }
.thumb-tile .ic{ width:20px; height:20px; }
.thumb-tile.failed{ border:1.5px dashed var(--c-danger); color:var(--c-danger); background:var(--c-danger-bg); }
.cap{ font-size:var(--fs-xs); line-height:1.3; margin-top:var(--sp-1); color:var(--c-ink-2); }
.cap b{ color:var(--c-ink); }
.cap .fn{ display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* ---------- Linha do tempo ---------- */
.tl{ list-style:none; margin:0; padding:0; }
.tl li{ display:grid; grid-template-columns:27mm 16px 1fr; gap:var(--sp-4); break-inside:avoid; }
.tl .when{ font-size:var(--fs-sm); color:var(--c-ink-2); text-align:right; padding:var(--sp-3) 0; font-variant-numeric:tabular-nums; }
.tl .rail{ position:relative; }
.tl .rail::before{ content:""; position:absolute; left:7px; top:0; bottom:0; border-left:1.5px solid var(--c-line); }
.tl li:first-child .rail::before{ top:12px; }
.tl li:last-child .rail::before{ bottom:calc(100% - 12px); }
.tl .dot{ position:absolute; left:2px; top:7px; width:12px; height:12px; border-radius:50%; border:1.5px solid var(--c-ink); }
.tl .what{ padding:var(--sp-3) 0; border-bottom:1px solid var(--c-line-soft); }
.tl .state{ font-weight:700; font-size:var(--fs-sm); }

/* ---------- Chat ---------- */
.notice{ display:flex; gap:var(--sp-4); align-items:flex-start; border:1px solid var(--c-info); background:var(--c-info-bg); color:var(--c-ink); padding:var(--sp-4) var(--sp-5); border-radius:var(--radius); font-size:var(--fs-sm); margin-bottom:var(--sp-5); break-inside:avoid; }
.notice .ic{ color:var(--c-info); }
.chat-day{ font-size:var(--fs-xs); font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--c-ink-2); border-bottom:1px solid var(--c-line); padding:var(--sp-4) 0 var(--sp-2); margin-top:var(--sp-3); break-after:avoid; }
.msg{ display:grid; grid-template-columns:11mm 40mm 1fr; gap:var(--sp-4); padding:var(--sp-2) 0; border-bottom:1px solid var(--c-line-soft); font-size:var(--fs-sm); break-inside:avoid; }
.msg .t{ color:var(--c-muted); font-variant-numeric:tabular-nums; }
.msg .a{ font-weight:600; overflow-wrap:anywhere; }
.msg .att-ref{ display:inline-flex; gap:var(--sp-2); align-items:center; color:var(--c-ink-2); font-size:var(--fs-xs); margin-top:var(--sp-1); }

.end{ margin-top:var(--sp-8); padding-top:var(--sp-4); border-top:1px solid var(--c-line); font-size:var(--fs-xs); color:var(--c-muted); text-align:center; break-inside:avoid; }
`;

/* ------------------------------------------------------------------ */
/* Blocos de renderização                                              */
/* ------------------------------------------------------------------ */

function sectionTitle(n, title, iconName, countText) {
  return `<h2 class="sec-title"><span class="n">${esc(n)}</span>${icon(iconName)}<span>${esc(title)}</span>${countText ? `<span class="count">${esc(countText)}</span>` : ''}</h2>`;
}

function emptyState(text, iconName = 'info') {
  return `<div class="empty">${icon(iconName)}<span>${esc(text)}</span></div>`;
}

function renderCover(d, task, stats, elapsed) {
  const stateId = int(task.state && task.state.id, 0);
  const stateLabel = (task.state && task.state.description) || TASK_STATES[stateId] || 'Sem estado';
  const pr = PRIORITIES[int(task.priority, 0)] || PRIORITIES[0];
  const closed = CLOSED_STATES.has(stateId);
  const days = int(task.days_to_deadline, 0);
  const pct = Math.max(0, Math.min(100, int(task.percent, 0)));
  const logo = safeImg(d.brand && d.brand.logo);

  let deadlineChip;
  if (closed) {
    deadlineChip = `<span class="chip">${icon('calendar')}<span class="k">Prazo</span> ${esc(fmtDate(task.final_date))}</span>`;
  } else if (days < 0) {
    deadlineChip = `<span class="chip danger">${icon('alert')}Atrasada há ${esc(plural(-days, 'dia', 'dias'))} · prazo ${esc(fmtDate(task.final_date))}</span>`;
  } else if (days <= LIMITS.DEADLINE_NEAR_DAYS) {
    deadlineChip = `<span class="chip warn">${icon('clock')}${days === 0 ? 'Vence hoje' : `Faltam ${esc(plural(days, 'dia', 'dias'))}`} · prazo ${esc(fmtDate(task.final_date))}</span>`;
  } else {
    deadlineChip = `<span class="chip">${icon('calendar')}Faltam ${esc(plural(days, 'dia', 'dias'))} <span class="k">· prazo ${esc(fmtDate(task.final_date))}</span></span>`;
  }

  const kpi = (label, iconName, value, extra, cls) =>
    `<div class="kpi ${cls || ''}"><div class="kpi-label">${icon(iconName)}${esc(label)}</div><div class="kpi-value">${value}${extra ? ` <small>${extra}</small>` : ''}</div></div>`;
  const z = (n, alert) => (n === 0 ? 'zero' : alert ? 'alert' : '');

  const elapsedShown = elapsed === null ? null : Math.min(elapsed, 100);
  const bars = `
    <div class="bars">
      <span class="bar-label">Progresso da tarefa</span>
      <div class="track"><div class="fill" style="width:${pct}%"></div></div>
      <span class="bar-val">${pct}%</span>
      ${elapsedShown === null ? '' : `
      <span class="bar-label">Prazo decorrido</span>
      <div class="track"><div class="fill time" style="width:${elapsedShown}%"></div></div>
      <span class="bar-val">${elapsed > 100 ? '&gt;100' : elapsedShown}%</span>`}
    </div>
    <p class="bar-hint">Barra sólida: progresso informado na tarefa. Barra hachurada: parte do período (${esc(fmtDate(task.initial_date))} a ${esc(fmtDate(task.final_date))}) já transcorrida em ${esc(fmtDate(d.generated_at))}.</p>`;

  return `
  <header class="cover">
    <div class="brand">
      ${logo ? `<img src="${logo}" alt="">` : `<span class="brand-name">${esc((d.brand && d.brand.name) || 'Peg Pesé')}</span>`}
      <span class="eyebrow">GTPP · Gerenciador de tarefas</span>
    </div>
    ${task.disqualified ? `<div class="banner">${icon('ban')}Tarefa desqualificada</div>` : ''}
    <div class="eyebrow">Dossiê da tarefa · nº ${esc(task.id)}</div>
    <h1>${esc(clip(task.title, 300).text)}</h1>
    <p class="cover-meta">Criada por <b>${esc((task.creator && task.creator.name) || '—')}</b> · Período ${esc(fmtDate(task.initial_date))} a ${esc(fmtDate(task.final_date))}</p>
    ${safeUrl(task.url) ? `<p class="open-link">${linkTo(task.url, `Abrir a tarefa no GTPP${icon('external')}`, 'lnk-text')}</p>` : ''}
    <div class="chips">
      <span class="chip"><span class="swatch" style="background:${safeColor(task.state && task.state.color)}"></span><span class="k">Estado</span> ${esc(stateLabel)}</span>
      <span class="chip">${priorityIcon(pr.bars)}<span class="k">Prioridade</span> ${esc(pr.label)}</span>
      ${deadlineChip}
    </div>
    ${bars}
    <div class="kpis">
      ${kpi('Itens concluídos', 'check', `${stats.concluded}`, `de ${stats.total}`, stats.total === 0 ? 'zero' : '')}
      ${kpi('Itens vencidos', 'alert', `${stats.overdue.length}`, '', z(stats.overdue.length, true))}
      ${kpi('Perguntas sem resposta', 'question', `${stats.unanswered.length}`, stats.questions ? `de ${stats.questions}` : '', z(stats.unanswered.length, false))}
      ${kpi('Sem responsável', 'userOff', `${stats.unassigned.length}`, '', z(stats.unassigned.length, false))}
      ${kpi('Evidências anexadas', 'clip', `${stats.evidence}`, '', z(stats.evidence, false))}
    </div>
  </header>`;
}

function renderAttention(points) {
  const body = points.length
    ? `<ul class="att">${points.map((p) => {
      const lv = { critical: ['octagon', 'Crítico'], warning: ['alert', 'Atenção'], info: ['info', 'Info'] }[p.level];
      return `<li><span class="lvl ${p.level}">${icon(lv[0])}${lv[1]}</span><div><div class="att-title">${esc(p.title)}</div><div class="att-detail">${esc(p.detail)}</div></div></li>`;
    }).join('')}</ul>`
    : emptyState('Nenhum ponto de atenção: sem itens vencidos, perguntas pendentes ou evidências com falha.', 'check');
  return `<section class="sec">${sectionTitle('1', 'Pontos de atenção', 'flag', points.length ? plural(points.length, 'ponto', 'pontos') : '')}${body}</section>`;
}

function renderDescriptionAndPeople(d, task) {
  const desc = task.full_description && String(task.full_description).trim()
    ? `<div class="desc-box pre">${richText(task.full_description, LIMITS.DESCRIPTION_MAX, '(descrição truncada — consulte o GTPP)')}</div>`
    : emptyState('Tarefa sem descrição.');

  const participants = (d.participants || []).slice().sort((a, b) =>
    (b.is_creator ? 1 : 0) - (a.is_creator ? 1 : 0) || (b.active !== false) - (a.active !== false) || String(a.name).localeCompare(String(b.name), 'pt-BR'));
  const people = participants.length
    ? `<div class="people">${participants.map((p) => {
      const photo = safeImg(p.photo);
      const av = photo ? `<img class="avatar" src="${photo}" alt="">` : `<span class="avatar ini">${esc(initials(p.name))}</span>`;
      const tags = `${p.is_creator ? '<span class="tag">Criador</span>' : ''}${p.active === false ? '<span class="tag dashed">Inativo</span>' : ''}`;
      return `<div class="person${p.active === false ? ' inactive' : ''}">${av}<div style="min-width:0"><div class="person-name">${esc(p.name)}</div>${tags ? `<div>${tags}</div>` : ''}</div></div>`;
    }).join('')}</div>`
    : emptyState('Nenhum participante vinculado.', 'people');

  const scope = (d.scope || []).length
    ? `<table><thead><tr><th>Empresa</th><th>Filial</th><th>Centro de custo</th></tr></thead><tbody>${d.scope.map((s) =>
      `<tr><td>${esc(s.company || '—')}</td><td>${esc(s.branch || '—')}</td><td>${esc(s.cost_center || '—')}</td></tr>`).join('')}</tbody></table>`
    : emptyState('Escopo não definido.');

  return `
  <section class="sec">${sectionTitle('2', 'Descrição', 'doc')}${desc}</section>
  <section class="sec">${sectionTitle('3', 'Participantes e escopo', 'people', plural(participants.length, 'participante', 'participantes'))}
    ${people}
    <h3 class="sub-title">Escopo</h3>${scope}
  </section>`;
}

function statusInline(v) {
  return `<span class="st ${v.tone}">${icon(v.icon)}${esc(v.label)}</span>`;
}

function renderChecklistTable(items, registry) {
  if (!items.length) return emptyState('Nenhum item cadastrado no checklist.', 'list');
  const rows = items.map((it) => {
    const v = itemStatusView(it);
    const reg = registry.byItem.get(it);
    const nAtt = (reg.own ? 1 : 0) + reg.comments.reduce((s, c) => s + c.length, 0);
    const nCom = (it.comments || []).length;
    const overdue = v.tone === 'danger';
    const counts = [
      nAtt ? `<span>${icon('clip')}${nAtt}</span>` : '',
      nCom ? `<span>${icon('comment')}${nCom}</span>` : '',
      it.note ? `<span>${icon('doc')}obs.</span>` : '',
    ].join('') || '<span class="muted">—</span>';
    return `<tr class="${overdue ? 'row-danger' : ''}">
      <td class="num nowrap">${pad2(it.order)}</td>
      <td>${it.type === 'question' ? '<span class="type-q">PERGUNTA</span>' : ''}${linkTo(it.url, esc(clip(it.description, LIMITS.ITEM_DESC_MAX).text))}</td>
      <td>${statusInline(v)}</td>
      <td class="wrap">${it.assigned_to ? esc(it.assigned_to.name) : '<span class="st warn">' + icon('userOff') + 'Sem resp.</span>'}</td>
      <td class="num nowrap">${overdue ? `<b>${esc(fmtDateShort(it.final_date))}</b>` : esc(fmtDateShort(it.final_date))}</td>
      <td class="counts">${counts}</td>
    </tr>`;
  }).join('');
  return `<table class="checklist">
    <colgroup><col style="width:10mm"><col><col style="width:33mm"><col style="width:34mm"><col style="width:18mm"><col style="width:22mm"></colgroup>
    <thead><tr><th>Nº</th><th>Item</th><th>Status</th><th>Responsável</th><th>Prazo</th><th>Registros</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderThumb(a) {
  const cap = `<div class="cap"><b>${esc(a.ref)}</b> · ${esc(fmtSize(a.size))}<span class="fn">${linkTo(a.url, esc(a.name), 'lnk-text')}</span></div>`;
  if (a.type === 'image' && a.thumb) {
    return `<div class="thumb">${linkTo(a.url, `<img class="thumb-img" src="${a.thumb}" alt="">`)}${cap}</div>`;
  }
  const failed = a.status === 'failed';
  const label = failed ? 'Falha no processamento'
    : a.type === 'image' ? 'Miniatura indisponível'
    : (a.status === 'pending' || a.status === 'processing') ? PROCESSING_LABELS[a.status]
      : `${ATTACHMENT_TYPES[a.type]} · ver índice`;
  const tile = `<div class="thumb-tile${failed ? ' failed' : ''}">${icon(failed ? 'alert' : attachmentIcon(a.type))}<span>${esc(ATTACHMENT_TYPES[a.type].toUpperCase())}</span><span style="font-weight:400">${esc(label)}</span></div>`;
  return `<div class="thumb">${linkTo(a.url, tile)}${cap}</div>`;
}

function renderItemCard(it, registry) {
  const v = itemStatusView(it);
  const reg = registry.byItem.get(it);
  const comments = it.comments || [];
  const overdue = v.tone === 'danger';
  const totalAtt = (reg.own ? 1 : 0) + reg.comments.reduce((s, c) => s + c.length, 0);
  const small = comments.length <= 1 && totalAtt <= 2;

  const metaParts = [
    `<span>${icon('user')} ${it.assigned_to ? esc(it.assigned_to.name) : '<b class="warn-text">Sem responsável</b>'}</span>`,
    `<span>${icon('calendar')} ${esc(fmtDate(it.initial_date))} → ${overdue ? `<b class="warn-text">${esc(fmtDate(it.final_date))} (vencido)</b>` : esc(fmtDate(it.final_date))}</span>`,
  ];

  const blocks = [];
  if (it.note) {
    blocks.push(`<div class="block-label">${icon('doc')}Observação</div><div class="note pre">${richText(it.note, LIMITS.NOTE_MAX)}</div>`);
  }
  if (reg.own) {
    blocks.push(`<div class="block-label">${icon('clip')}Evidência do item</div><div class="thumbs">${renderThumb(reg.own)}</div>`);
  }
  blocks.push(`<div class="block-label">${icon('comment')}Comentários (${comments.length})</div>`);
  if (comments.length) {
    blocks.push(`<ul class="comments">${comments.map((c, i) => {
      const atts = reg.comments[i] || [];
      return `<li class="comment">
        <div class="comment-head"><b>${esc(c.author || '—')}</b> <span class="muted">· ${esc(fmtDateTime(c.created_at))}</span></div>
        ${c.text ? `<div class="comment-text pre">${richText(c.text, LIMITS.COMMENT_TEXT_MAX)}</div>` : ''}
        ${atts.length ? `<div class="thumbs">${atts.map(renderThumb).join('')}</div>` : ''}
      </li>`;
    }).join('')}</ul>`);
  } else {
    blocks.push(emptyState('Nenhum comentário registrado.', 'comment'));
  }

  return `<article class="card ${v.tone}${small ? ' small' : ''}">
    <div class="card-head">
      <div>
        <div class="eyebrow">Item ${pad2(it.order)} · ${it.type === 'question' ? 'Pergunta' : 'Verificação'}</div>
        <div class="card-title">${linkTo(it.url, esc(clip(it.description, LIMITS.ITEM_DESC_MAX).text))}</div>
        <div class="meta">${metaParts.join('')}</div>
      </div>
      <span class="badge ${v.tone}">${icon(v.icon)}${esc(v.label)}</span>
    </div>
    <div class="card-body">${blocks.join('')}</div>
  </article>`;
}

function renderChecklist(items, registry, stats) {
  const detailed = items.filter((it) => it.note || it.attachment || (it.comments || []).length);
  const cards = detailed.length
    ? detailed.map((it) => renderItemCard(it, registry)).join('')
    : emptyState('Nenhum item possui observação, evidência ou comentário.', 'comment');
  const countText = items.length ? `${stats.concluded} de ${items.length} concluídos` : '';
  return `<section class="sec">${sectionTitle('4', 'Checklist', 'list', countText)}
    <h3 class="sub-title">4.1 Visão geral</h3>
    ${renderChecklistTable(items, registry)}
    ${items.length ? `<h3 class="sub-title">4.2 Detalhamento e evidências</h3>
    <p class="lead">Apenas itens com observação, evidência ou comentário. Os demais aparecem só na visão geral.</p>
    ${cards}` : ''}
  </section>`;
}

function renderTimeline(history) {
  const list = (history || []).slice().sort((a, b) => sortKey(a.created_at).localeCompare(sortKey(b.created_at)));
  const body = list.length
    ? `<ol class="tl">${list.map((h) => `<li>
        <div class="when">${esc(fmtDate(h.created_at))}<br>${esc(fmtTime(h.created_at))}</div>
        <div class="rail"><span class="dot" style="background:${safeColor(h.state && h.state.color)}"></span></div>
        <div class="what"><div class="state">${esc((h.state && h.state.description) || '—')}</div>${h.description ? `<div class="pre" style="font-size:var(--fs-sm)">${richText(h.description, LIMITS.COMMENT_TEXT_MAX)}</div>` : ''}</div>
      </li>`).join('')}</ol>`
    : emptyState('Nenhum registro de histórico.', 'history');
  return `<section class="sec">${sectionTitle('5', 'Linha do tempo', 'history', list.length ? plural(list.length, 'registro', 'registros') : '')}${body}</section>`;
}

function originText(a) {
  const o = a.origin;
  if (o.kind === 'item') return `Item ${pad2(o.order)} · evidência do item`;
  if (o.kind === 'comment') return `Item ${pad2(o.order)} · comentário de ${o.author || '—'} em ${fmtDateTime(o.created_at)}`;
  return `Chat · ${o.author || '—'} em ${fmtDateTime(o.created_at)}`;
}

function renderAttachmentIndex(registry) {
  const list = registry.list;
  const body = list.length
    ? `<table>
      <colgroup><col style="width:11mm"><col><col style="width:17mm"><col style="width:16mm"><col style="width:58mm"><col style="width:26mm"></colgroup>
      <thead><tr><th>Ref.</th><th>Arquivo</th><th>Tipo</th><th class="r">Tamanho</th><th>Origem</th><th>Situação</th></tr></thead>
      <tbody>${list.map((a) => {
        const stTone = a.status === 'failed' ? 'danger' : a.status === 'ready' ? 'neutral' : 'warn';
        const stIcon = a.status === 'failed' ? 'alert' : a.status === 'ready' ? 'check' : 'clock';
        return `<tr class="${a.status === 'failed' ? 'row-danger' : ''}">
          <td class="num"><b>${esc(a.ref)}</b></td>
          <td class="wrap">${a.url ? linkTo(a.url, `${esc(a.name)}${icon('external')}`, 'lnk-text') : esc(a.name)}</td>
          <td><span class="st neutral">${icon(attachmentIcon(a.type))}${esc(ATTACHMENT_TYPES[a.type])}</span></td>
          <td class="r num">${esc(fmtSize(a.size))}</td>
          <td class="wrap">${esc(originText(a))}</td>
          <td><span class="st ${stTone}">${icon(stIcon)}${esc(PROCESSING_LABELS[a.status])}</span></td>
        </tr>`;
      }).join('')}</tbody></table>`
    : emptyState('Nenhum anexo registrado na tarefa.', 'clip');
  const omitted = registry.omittedThumbs
    ? `<div class="notice">${icon('info')}<span>Para manter o arquivo leve, ${registry.omittedThumbs} miniatura(s) de imagem não foram embutidas (limite de ${LIMITS.MAX_EMBEDDED_THUMBS}). Elas continuam listadas abaixo.</span></div>` : '';
  const hasLinks = list.some((a) => a.url);
  const lead = list.length
    ? `<p class="lead">${hasLinks
      ? 'Clique no nome do arquivo (ou na miniatura) para abri-lo no GTPP, com login. Impresso, use a referência (A1, A2…) para localizá-lo.'
      : 'Vídeos, PDFs e demais arquivos não abrem dentro deste documento: use a referência (A1, A2…) para localizá-los no GTPP.'}</p>` + omitted
    : '';
  return `<section class="sec">${sectionTitle('6', 'Índice de anexos', 'clip', list.length ? plural(list.length, 'arquivo', 'arquivos') : '')}${lead}${body}</section>`;
}

function renderChat(d, registry) {
  const all = (d.messages || []).slice().sort((a, b) => sortKey(a.created_at).localeCompare(sortKey(b.created_at)));
  const total = Math.max(int(d.messages_total, all.length), all.length);
  const shown = all.slice(-LIMITS.CHAT_MAX_MESSAGES);
  let body;
  if (!all.length) {
    body = emptyState('Nenhuma mensagem no chat da tarefa.', 'chat');
  } else {
    let lastDay = '';
    const rows = shown.map((m) => {
      const k = dayKey(m.created_at);
      const head = k !== lastDay ? `<div class="chat-day">${esc(weekday(m.created_at))}, ${esc(fmtDate(m.created_at))}</div>` : '';
      lastDay = k;
      const att = registry.byMessage.get(m);
      return `${head}<div class="msg"><span class="t">${esc(fmtTime(m.created_at))}</span><span class="a">${esc(m.author || '—')}</span><div>
        ${m.text ? `<div class="pre">${richText(m.text, LIMITS.CHAT_TEXT_MAX)}</div>` : ''}
        ${att ? `<div class="att-ref">${icon(attachmentIcon(att.type))}<b>${esc(att.ref)}</b> ${linkTo(att.url, esc(att.name), 'lnk-text')}</div>` : ''}
      </div></div>`;
    }).join('');
    const notice = total > shown.length
      ? `<div class="notice">${icon('info')}<span>Exibindo as <b>${shown.length}</b> mensagens mais recentes de um total de <b>${total}</b>. O histórico completo está disponível no GTPP.</span></div>`
      : '';
    body = notice + rows;
  }
  return `<section class="sec page-break">${sectionTitle('A', 'Anexo — Chat da tarefa', 'chat', all.length ? plural(total, 'mensagem', 'mensagens') : '')}${body}</section>`;
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

function renderTaskDossierHtml(dossier) {
  const d = dossier || {};
  const task = d.task || {};
  const items = (d.items || []).slice().sort((a, b) => int(a.order) - int(b.order));
  const messages = (d.messages || []).slice().sort((a, b) => sortKey(a.created_at).localeCompare(sortKey(b.created_at)));
  const registry = buildAttachmentRegistry(items, messages);
  const stats = computeStats(d, items, registry);
  const elapsed = elapsedPercent(task, d.generated_at);
  const attention = computeAttention(d, task, stats, elapsed);

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Dossiê da tarefa nº ${esc(task.id)} — ${esc(clip(task.title, 80).text)}</title>
<style>${CSS}</style></head>
<body><main>
${renderCover(d, task, stats, elapsed)}
${renderAttention(attention)}
${renderDescriptionAndPeople(d, task)}
${renderChecklist(items, registry, stats)}
${renderTimeline(d.history)}
${renderAttachmentIndex(registry)}
${renderChat({ ...d, messages }, registry)}
<p class="end">Fim do dossiê da tarefa nº ${esc(task.id)} · gerado em ${esc(fmtDateTime(d.generated_at))} por ${esc((d.generated_by && d.generated_by.name) || '—')} · documento interno Peg Pesé</p>
</main></body></html>`;
}

/**
 * headerTemplate do Puppeteer. Estilos precisam ser inline; fontes e tamanhos
 * explícitos (o padrão do Chrome no cabeçalho é minúsculo).
 */
function buildPdfHeaderTemplate({ logo, taskId, title } = {}) {
  const img = safeImg(logo);
  const t = clip(title, LIMITS.HEADER_TITLE_MAX).text;
  return `<div style="box-sizing:border-box;width:100%;padding:0 14mm;font-family:'Segoe UI',Roboto,Arial,'Liberation Sans','DejaVu Sans',sans-serif;font-size:8pt;color:#3D4751;-webkit-print-color-adjust:exact;">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:8mm;border-bottom:0.5pt solid #9AA5AF;padding-bottom:2mm;">
    <div style="display:flex;align-items:center;gap:3mm;white-space:nowrap;flex:none;">
      ${img ? `<img src="${img}" style="height:6mm;width:auto;">` : '<b style="color:#0F4C81;">Peg Pesé</b>'}
      <span>GTPP · Dossiê da tarefa</span>
    </div>
    <div style="flex:1 1 auto;min-width:0;max-width:120mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;"><b style="color:#1A1F24;">Nº ${esc(taskId)}</b> — ${esc(t)}</div>
  </div>
</div>`;
}

function buildPdfFooterTemplate({ generatedAt, generatedByName } = {}) {
  return `<div style="box-sizing:border-box;width:100%;padding:0 14mm;font-family:'Segoe UI',Roboto,Arial,'Liberation Sans','DejaVu Sans',sans-serif;font-size:7.5pt;color:#5A6570;-webkit-print-color-adjust:exact;">
  <div style="display:flex;justify-content:space-between;gap:8mm;border-top:0.5pt solid #9AA5AF;padding-top:2mm;">
    <span>Gerado em ${esc(fmtDateTime(generatedAt))} por ${esc(generatedByName || '—')} · Documento interno</span>
    <span style="white-space:nowrap;color:#1A1F24;">Página <b class="pageNumber"></b> de <span class="totalPages"></span></span>
  </div>
</div>`;
}

module.exports = {
  renderTaskDossierHtml,
  buildPdfHeaderTemplate,
  buildPdfFooterTemplate,
  LIMITS,
  // expostos para testes unitários
  _internals: { esc, safeUrl, itemStatusView, computeAttention, computeStats, buildAttachmentRegistry, elapsedPercent, fmtSize, fmtDateTime },
};
