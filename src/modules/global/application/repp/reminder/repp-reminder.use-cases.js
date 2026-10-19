/**
 * @fileoverview Disparo dos lembretes da REPP — um ciclo do worker
 * `repp-reminder`.
 *
 * Para cada reserva com lembrete vencido: trava, carimba `reminder_sent_at`,
 * grava o aviso `reminder` ao criador e, depois do commit, manda o
 * `repp:event`. É o mesmo caminho dos avisos das ações (gravado primeiro,
 * WebSocket só como atalho), então o sino do front trata o lembrete como
 * qualquer outro aviso.
 *
 * Uma reserva que falha não segura as outras: o erro é registrado e ela
 * volta no próximo ciclo, porque nada foi carimbado.
 *
 * @module modules/global/application/repp/reminder/repp-reminder.use-cases
 */

const { buildReminderNotice, toEventPayload } = require('../../../domain/repp/notification.rules');

/** Teto de lembretes por ciclo; o que sobrar sai no ciclo seguinte. */
const REMINDER_BATCH = 100;

class ReppReminderUseCases {
    /**
     * @param {object} deps
     * @param {import('./ports/reminder-repository.port').ReminderRepositoryPort} deps.reminderRepository
     * @param {import('../booking/ports/booking-event-publisher.port').BookingEventPublisherPort} deps.eventPublisher
     * @param {(message: string) => void} [deps.logError]
     */
    constructor({ reminderRepository, eventPublisher, logError = console.error }) {
        this.reminderRepository = reminderRepository;
        this.eventPublisher = eventPublisher;
        this.logError = logError;
    }

    /** @returns {Promise<{due: number, sent: number, failed: number}>} */
    async runCycle() {
        const ids = await this.reminderRepository.listDueIds(REMINDER_BATCH);
        let sent = 0;
        let failed = 0;

        for (const bookingId of ids) {
            try {
                const fired = await this.reminderRepository.withDueReminder(bookingId, async (tx) => {
                    await tx.markSent();
                    const notice = buildReminderNotice(tx.booking);
                    if (!notice) return null;
                    return { notice, id: await tx.insertNotification(notice) };
                });
                if (!fired) continue;
                sent += 1;
                // Depois do commit. Nunca lança (ver a porta).
                await this.eventPublisher.publish(fired.notice.user_id, toEventPayload(fired.id, fired.notice));
            } catch (error) {
                failed += 1;
                this.logError(`[repp:reminder] Failed to send reminder for booking id=${bookingId}: ${error?.message}`);
            }
        }

        return { due: ids.length, sent, failed };
    }
}

module.exports = { ReppReminderUseCases, REMINDER_BATCH };
