/**
 * @fileoverview Casos de uso da trilha de auditoria (`miepp_audit_log`).
 *
 * A *gravação* não passa por aqui na maioria dos casos — quem grava é o
 * middleware `miepp-audit.middleware`, para que nenhum controller precise
 * lembrar de fazê-lo. Este módulo existe para a leitura (rota `/audit-log`) e
 * para o caso em que um caso de uso queira registrar algo fora do ciclo
 * requisição/resposta.
 *
 * @module modules/global/application/miepp/audit/miepp-audit.use-cases
 */

const { normalizePagination, paginated } = require('../../../domain/miepp/pagination.rules');

class MieppAuditUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/miepp-audit-repository.port').MieppAuditRepositoryPort} deps.repository
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

    /** @param {object} entry - ver `MieppAuditRepositoryPort#record`. */
    async record(entry) {
        return this.repository.record(entry);
    }
}

module.exports = { MieppAuditUseCases };
