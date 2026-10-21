/**
 * @fileoverview Shaper puro: linhas do banco → contrato `dossier` consumido
 * por `renderTaskDossierHtml` (templates/gtpp-dossier).
 *
 * Sem I/O: miniaturas e nomes de escopo chegam prontos do caso de uso.
 *
 * @module modules/global/domain/gtpp/task-dossier/task-dossier.shaper
 */

'use strict';

/** Chaves do mapa de miniaturas que o caso de uso preenche. */
const thumbKey = Object.freeze({
    item:         (id) => `item:${id}`,
    responseFile: (id) => `response-file:${id}`,
    user:         (id) => `user:${id}`,
});

/**
 * yes_no: -1 = pergunta sem resposta, 0 = item comum, 1 = sim, 2 = não.
 * Mesma leitura do motor de auto-transição (`SQL_COUNT_ITEM_STATS`): pergunta
 * respondida conta como concluída, com ou sem `check`.
 */
function itemTypeAndStatus(row) {
    const yesNo = Number(row.yes_no);
    if (yesNo === 1) return { type: 'question', status: 'answered_yes' };
    if (yesNo === 2) return { type: 'question', status: 'answered_no' };
    if (yesNo === -1) return { type: 'question', status: 'unanswered' };
    return { type: 'check', status: Number(row.check) === 1 ? 'done' : 'pending' };
}

/** Tipo de anexo pelo MIME de `_files` (a extensão gravada não é confiável). */
function attachmentType(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m === 'application/pdf') return 'pdf';
    return 'other';
}

/** Só imagens viram miniatura; vídeo, PDF e o resto aparecem como bloco. */
function isThumbable(mime) {
    return attachmentType(mime) === 'image';
}

/** `gt_task_state.color` é gravado sem `#` (`9C2A0C`); o template exige `#RGB`/`#RRGGBB`. */
function normalizeColor(color) {
    const c = String(color || '').trim();
    if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return c.startsWith('#') ? c : `#${c}`;
    return null;
}

function toNumberOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** `Date` → `YYYY-MM-DDTHH:mm:ss` no horário local do processo, sem fuso. */
function toLocalIsoDateTime(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
        + `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function scopeLevel(code, name, allLabel) {
    if (!code) return allLabel;
    return name ? `${code} · ${name}` : String(code);
}

/**
 * Escopo novo (`gt_task_scope`, códigos do Protheus) com os nomes já
 * resolvidos; sem escopo novo, cai no legado (`gt_task_csds`).
 */
function shapeScope(scopeRows = [], legacyRows = []) {
    if (scopeRows.length) {
        return scopeRows.map(s => ({
            company:     scopeLevel(s.company_code, s.company_name, 'Todas'),
            branch:      scopeLevel(s.branch_code, s.branch_name, 'Todas'),
            cost_center: scopeLevel(s.cost_center_code, s.cost_center_name, 'Todos'),
        }));
    }
    return legacyRows.map(c => ({
        company:     c.company_description || '—',
        branch:      c.shop_description || '—',
        cost_center: c.depart_description || '—',
    }));
}

/**
 * Fontes de miniatura em ordem de leitura do documento (item → arquivo do
 * item → anexos dos comentários), cortadas em `max` — a mesma ordem em que o
 * template numera A1, A2… e aplica o seu limite de miniaturas.
 *
 * @returns {Array<{key: string, filePath: string}>}
 */
function listEvidenceThumbSources({ items = [], responses = [], responseFiles = [] }, max) {
    const responsesByItem = groupBy(responses, r => r.task_item_id_fk);
    const filesByResponse = groupBy(responseFiles, f => f.task_item_response_id_fk);
    const out = [];
    for (const it of items) {
        if (out.length >= max) break;
        if (it.file_path && isThumbable(it.file_type)) out.push({ key: thumbKey.item(it.id), filePath: it.file_path });
        for (const r of responsesByItem.get(it.id) || []) {
            for (const f of filesByResponse.get(r.id) || []) {
                if (f.file_path && isThumbable(f.file_type) && f.processing_status !== 'failed') {
                    out.push({ key: thumbKey.responseFile(f.id), filePath: f.file_path });
                }
            }
        }
    }
    return out.slice(0, max);
}

/** @returns {Array<{key: string, filePath: string}>} */
function listAvatarThumbSources(participants = []) {
    return participants
        .filter(p => p.photo_file_path && isThumbable(p.photo_file_type))
        .map(p => ({ key: thumbKey.user(p.id), filePath: p.photo_file_path }));
}

function groupBy(list, keyFn) {
    const map = new Map();
    for (const el of list) {
        const k = keyFn(el);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(el);
    }
    return map;
}

function shapeItemAttachment(row, thumbs, url) {
    if (row.file_id) {
        return {
            name: row.file_name || `arquivo-item-${row.id}`,
            type: attachmentType(row.file_type),
            size: toNumberOrNull(row.file_size),
            thumb: thumbs.get(thumbKey.item(row.id)) || null,
            processing_status: 'ready',
            url,
        };
    }
    if (Number(row.has_legacy_blob) === 1) {
        // BLOB legado: sem MIME nem nome original — só a referência no índice.
        return {
            name: row.file_name || `arquivo-item-${row.id}`,
            type: 'other',
            size: toNumberOrNull(row.legacy_blob_size),
            thumb: null,
            processing_status: 'ready',
            url,
        };
    }
    return null;
}

/**
 * Monta o objeto `dossier` do contrato do template.
 *
 * @param {object} params
 * @param {object} params.data       - retorno de `findDossierData` (linhas cruas).
 * @param {object[]} params.scope    - escopo com nomes resolvidos.
 * @param {Map<string,string>} params.thumbs - chave (`thumbKey`) → data URI.
 * @param {Date} params.generatedAt
 * @param {{id: number, name: string}} params.viewer
 * @param {{name: string, logo: string|null}} [params.brand]
 * @param {ReturnType<import('./task-dossier-links').buildDossierLinks>} [params.links]
 *        - sem links (null), o dossiê sai sem `url` nenhum.
 */
function buildTaskDossier({ data, scope = [], thumbs = new Map(), generatedAt, viewer, brand = null, links = null }) {
    const { task, participants = [], items = [], responses = [], responseFiles = [],
        messages = [], messagesTotal = 0, history = [], legacyScope = [] } = data;

    const responsesByItem = groupBy(responses, r => r.task_item_id_fk);
    const filesByResponse = groupBy(responseFiles, f => f.task_item_response_id_fk);
    const creatorId = Number(task.creator_id);
    const taskId = Number(task.id);
    const link = (fn, ...ids) => (links ? links[fn](taskId, ...ids) : null);

    const shapedItems = items.map(row => {
        const { type, status } = itemTypeAndStatus(row);
        return {
            order: Number(row.order),
            url: link('item', row.id),
            description: row.description || '',
            type,
            status,
            assigned_to: row.assigned_to ? { id: Number(row.assigned_to), name: row.assigned_name || `Usuário ${row.assigned_to}` } : null,
            note: row.note && String(row.note).trim() ? row.note : null,
            initial_date: row.initial_date,
            final_date: row.final_date,
            deadline_percent: toNumberOrNull(row.deadline_percent),
            overdue: Number(row.overdue) === 1,
            attachment: shapeItemAttachment(row, thumbs, link('itemFile', row.id)),
            comments: (responsesByItem.get(row.id) || []).map(r => ({
                author: r.author || '—',
                created_at: r.created_at,
                text: r.comment || '',
                attachments: (filesByResponse.get(r.id) || []).map(f => ({
                    name: f.file_name || `anexo-${f.id}`,
                    type: attachmentType(f.file_type),
                    size: toNumberOrNull(f.file_size),
                    thumb: thumbs.get(thumbKey.responseFile(f.id)) || null,
                    processing_status: f.processing_status || 'ready',
                    url: link('responseFile', row.id, f.id),
                })),
            })),
        };
    });

    // Progresso pela mesma régua dos KPIs do documento (itens concluídos ÷ total).
    const concluded = shapedItems.filter(i => ['done', 'answered_yes', 'answered_no'].includes(i.status)).length;
    const percent = shapedItems.length ? Math.round((concluded / shapedItems.length) * 100) : 0;

    return {
        generated_at: toLocalIsoDateTime(generatedAt),
        generated_by: { id: viewer.id, name: viewer.name || '—' },
        brand: brand || { name: 'Peg Pesé', logo: null },
        task: {
            id: taskId,
            url: link('task'),
            title: task.title || '',
            full_description: task.full_description || '',
            priority: toNumberOrNull(task.priority) ?? 0,
            state: { id: Number(task.state_id), description: task.state_description || '', color: normalizeColor(task.state_color) },
            initial_date: task.initial_date,
            final_date: task.final_date,
            days_to_deadline: toNumberOrNull(task.days_to_deadline) ?? 0,
            percent,
            disqualified: Number(task.disqualify) === 1,
            creator: { id: creatorId, name: task.creator_name || '—' },
        },
        participants: participants.map(p => ({
            id: Number(p.id),
            name: p.name || '—',
            active: Number(p.active) === 1,
            photo: thumbs.get(thumbKey.user(p.id)) || null,
            is_creator: Number(p.id) === creatorId,
        })),
        scope: shapeScope(scope, legacyScope),
        items: shapedItems,
        messages: messages.map(m => ({
            author: m.author || '—',
            created_at: m.date_time,
            text: m.description || '',
            attachment: m.file_id ? {
                name: m.file_name || `arquivo-${m.file_id}`,
                type: attachmentType(m.file_type),
                size: toNumberOrNull(m.file_size),
                processing_status: 'ready',
                url: link('message', m.id),
            } : null,
        })),
        messages_total: Number(messagesTotal) || messages.length,
        history: history.map(h => ({
            created_at: h.date_time,
            description: h.description || '',
            state: { description: h.state_description || '', color: normalizeColor(h.state_color) },
        })),
    };
}

module.exports = {
    buildTaskDossier,
    listEvidenceThumbSources,
    listAvatarThumbSources,
    itemTypeAndStatus,
    attachmentType,
    shapeScope,
    toLocalIsoDateTime,
    normalizeColor,
    thumbKey,
};
