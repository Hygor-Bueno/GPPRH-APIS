/**
 * @fileoverview Casos de uso das notificações da REPP — o sino do usuário.
 *
 * Modelo "ler e confirmar" (decisão do Hygor, 08/10/2026): o GET devolve as
 * não lidas e NÃO apaga; o front confirma com `PATCH /notifications/read`.
 * Consumir no GET (como o `gt_notify` do GTPP) perderia o aviso se a página
 * recarregasse antes de ser lida, e o `StrictMode` do front descarta a
 * primeira resposta em desenvolvimento.
 *
 * ─── Retenção ───────────────────────────────────────────────────────────────
 * Lidas há mais de 30 dias são apagadas. Não há agendador: a API roda em
 * cluster de 2 instâncias, e um job de intervalo rodaria duplicado (é o que
 * obrigou o MIEPP e o CPPP a terem worker próprio). A limpeza roda no fim de
 * cada confirmação de leitura, em lote — é idempotente, então duas instâncias
 * apagando ao mesmo tempo não fazem mal, e só cresce lixo se ninguém ler
 * nada, caso em que também não nasce lida nova.
 *
 * @module modules/global/application/repp/notification/repp-notification.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { ReppErrorCode } = require('../../../domain/repp/repp.enums');
const {
    MAX_READ_IDS,
    READ_RETENTION_DAYS,
    shapeNotification,
    normalizeNotificationIds,
} = require('../../../domain/repp/notification.rules');

/** Teto de não lidas devolvidas de uma vez — protege a rota de um sino esquecido. */
const UNREAD_LIMIT = 200;

/** Linhas apagadas por limpeza; o resto fica para a próxima confirmação. */
const PURGE_BATCH = 1000;

class ReppNotificationUseCases {
    /**
     * @param {object} deps
     * @param {import('./ports/notification-repository.port').NotificationRepositoryPort} deps.notificationRepository
     */
    constructor({ notificationRepository }) {
        this.notificationRepository = notificationRepository;
    }

    /** `GET /spaces/notifications` — não lidas, mais recentes primeiro. */
    async listUnread(user) {
        const rows = await this.notificationRepository.listUnread(Number(user.id), UNREAD_LIMIT);
        return rows.map(shapeNotification);
    }

    /** `PATCH /spaces/notifications/read` — body `{ ids: number[] }`. */
    async markRead({ ids, user }) {
        const normalized = normalizeNotificationIds(ids);
        if (!normalized) {
            throw new AppError(
                `O campo 'ids' deve ser uma lista de 1 a ${MAX_READ_IDS} ids de notificação.`,
                400,
                { code: ReppErrorCode.InvalidNotificationIds },
            );
        }

        const updated = await this.notificationRepository.markRead(normalized, Number(user.id));

        try {
            await this.notificationRepository.purgeRead(READ_RETENTION_DAYS, PURGE_BATCH);
        } catch (error) {
            // Limpeza é manutenção: falhar nela não pode falhar a confirmação.
            console.error('[repp:notifications] Failed to purge read notifications:', error?.message);
        }

        return { updated };
    }
}

module.exports = { ReppNotificationUseCases, UNREAD_LIMIT, PURGE_BATCH };
