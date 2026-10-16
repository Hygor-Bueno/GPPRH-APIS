/**
 * @fileoverview Qual contrato do Protheus representa o CPF do relógio.
 *
 * Puro. O relógio identifica a pessoa só por CPF; o Protheus por matrícula +
 * filial, em sete empresas (`view_employee_with_company_info` faz a união). Um
 * mesmo CPF pode ter mais de uma linha: transferência entre empresas,
 * readmissão. Decisão de 08/10/2026: status do contrato e carga diária vêm do
 * Protheus, lidos em tempo real — sem cadastro paralelo na suite.
 *
 * @module modules/global/domain/cppp/employee.rules
 */

/**
 * Datas do Protheus chegam como `YYYYMMDD` (campo CHAR), vazias quando não
 * preenchidas, ou já como `Date` dependendo de como a view as expõe.
 *
 * @param {*} value
 * @returns {string|null} `YYYY-MM-DD`
 */
function normalizeProtheusDate(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    return null;
}

/**
 * Escolhe o contrato: o ativo de admissão mais recente; sem ativo, o último
 * desligado.
 *
 * @param {Array<{admittedAt: string|null, dismissedAt: string|null}>} rows
 * @returns {object|null}
 */
function pickContract(rows) {
    if (!rows?.length) return null;
    const byAdmission = (a, b) => String(b.admittedAt ?? '').localeCompare(String(a.admittedAt ?? ''));
    const active = rows.filter((row) => !row.dismissedAt).sort(byAdmission);
    if (active.length) return active[0];
    return [...rows].sort((a, b) => String(b.dismissedAt).localeCompare(String(a.dismissedAt)))[0];
}

module.exports = { normalizeProtheusDate, pickContract };
