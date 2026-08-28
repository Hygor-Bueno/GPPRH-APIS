/**
 * @fileoverview Casos de uso — Notificações GTPP.
 *
 * @module modules/global/application/gtpp/notify/gtpp-notify.use-cases
 */

class GtppNotifyUseCases {
    /** @param {{repository: import('./ports/notify-repository.port').NotifyRepositoryPort}} deps */
    constructor({ repository }) {
        this.repository = repository;
    }

    /**
     * Retorna e consome (deleta) todas as notificações pendentes do usuário.
     * O campo `object` é automaticamente parseado de JSON.
     * @param {number} userId
     */
    async getAndConsumeNotifications(userId) {
        const rows = await this.repository.getAndConsume(userId);

        rows.forEach(row => {
            if (row.object && typeof row.object === 'string') {
                try { row.object = JSON.parse(row.object); } catch { /* mantém string */ }
            }
        });

        return rows;
    }
}

module.exports = { GtppNotifyUseCases };
