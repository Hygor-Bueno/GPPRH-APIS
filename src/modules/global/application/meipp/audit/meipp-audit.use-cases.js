/**
 * @fileoverview Casos de uso da trilha de auditoria (`meipp_audit_log`).
 *
 * A *gravação* não passa por aqui na maioria dos casos — quem grava é o
 * middleware `meipp-audit.middleware`, para que nenhum controller precise
 * lembrar de fazê-lo. Este módulo existe para a leitura (rota `/audit-log`) e
 * para o caso em que um caso de uso queira registrar algo fora do ciclo
 * requisição/resposta.
 *
 * @module modules/global/application/meipp/audit/meipp-audit.use-cases
 */

const { normalizePagination, paginated } = require('../../../domain/meipp/pagination.rules');

class MeippAuditUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/meipp-audit-repository.port').MeippAuditRepositoryPort} deps.repository
     */
    constructor({ repository }) {
        this.repository = repository;
    }

    async list(query = {}) {
        const pagination = normalizePagination(query);

        const { rows, total } = await this.repository.list({
            ...pagination,
            entityType: query.entity_type || null,
            userId: query.user_id ? Number(query.user_id) : null,
        });

        return paginated(rows, total, pagination);
    }

    /** @param {object} entry - ver `MeippAuditRepositoryPort#record`. */
    async record(entry) {
        return this.repository.record(entry);
    }
}

module.exports = { MeippAuditUseCases };
