/**
 * @fileoverview Sino da REPP: buscar não consome; confirmar é idempotente e
 * só toca as do próprio usuário; a limpeza das lidas antigas não pode falhar
 * a confirmação.
 */

const { ReppNotificationUseCases, UNREAD_LIMIT } = require('../notification/repp-notification.use-cases');
const { NotificationRepositoryPort } = require('../notification/ports/notification-repository.port');

class FakeNotificationRepository extends NotificationRepositoryPort {
    constructor() {
        super();
        this.rows = [
            { id: 1, user_id: 300, booking_id: 7, action: 'canceled', by_user_id: 476, payload: { space_name: 'Auditório', reason: 'x' }, created_at: '2026-10-08T10:00:00', read_at: null },
            { id: 2, user_id: 300, booking_id: 8, action: 'approved', by_user_id: 476, payload: '{"space_name":"Sala de Treinamento"}', created_at: '2026-10-08T11:00:00', read_at: null },
            { id: 3, user_id: 999, booking_id: 9, action: 'approved', by_user_id: 476, payload: {}, created_at: '2026-10-08T12:00:00', read_at: null },
        ];
        this.purgeRead = jest.fn(async () => 0);
    }
    async listUnread(userId, limit) {
        return this.rows.filter((r) => r.user_id === userId && !r.read_at).sort((a, b) => b.id - a.id).slice(0, limit);
    }
    async markRead(ids, userId) {
        let n = 0;
        for (const r of this.rows) {
            if (ids.includes(r.id) && r.user_id === userId && !r.read_at) { r.read_at = 'agora'; n++; }
        }
        return n;
    }
}

function setup() {
    const notificationRepository = new FakeNotificationRepository();
    return { repo: notificationRepository, useCases: new ReppNotificationUseCases({ notificationRepository }) };
}

const USER = { id: 300 };

describe('sino da REPP', () => {
    it('devolve as não lidas no formato do evento, sem consumir', async () => {
        const { useCases } = setup();
        const first = await useCases.listUnread(USER);
        expect(first.map((n) => n.id)).toEqual([2, 1]);
        expect(first[1]).toEqual({
            id: 1, action: 'canceled', booking_id: 7, space_name: 'Auditório', booking_date: null, start_time: null,
            end_time: null, title: null, requester_name: null, by_name: null, reason: 'x', previous: null,
            by_user_id: 476, created_at: '2026-10-08T10:00:00', read_at: null,
        });
        expect(first[0].space_name).toBe('Sala de Treinamento'); // payload como string JSON também serve
        expect(await useCases.listUnread(USER)).toHaveLength(2);
        expect(UNREAD_LIMIT).toBe(200);
    });

    it('confirma idempotente e ignora id de outra pessoa', async () => {
        const { useCases, repo } = setup();
        expect(await useCases.markRead({ ids: [1, 1, 3], user: USER })).toEqual({ updated: 1 });
        expect(await useCases.markRead({ ids: [1], user: USER })).toEqual({ updated: 0 });
        expect(repo.rows.find((r) => r.id === 3).read_at).toBeNull();
        expect((await useCases.listUnread(USER)).map((n) => n.id)).toEqual([2]);
        expect(repo.purgeRead).toHaveBeenCalledWith(30, 1000);
    });

    it('ids inválidos são 400 com code próprio', async () => {
        const { useCases } = setup();
        for (const ids of [undefined, [], ['a'], [0], 'x', new Array(501).fill(1)]) {
            await expect(useCases.markRead({ ids, user: USER })).rejects.toMatchObject({ statusCode: 400, code: 'REPP_INVALID_NOTIFICATION_IDS' });
        }
    });

    it('falha na limpeza não falha a confirmação', async () => {
        const { useCases, repo } = setup();
        repo.purgeRead.mockRejectedValue(new Error('lock wait'));
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        await expect(useCases.markRead({ ids: [2], user: USER })).resolves.toEqual({ updated: 1 });
        spy.mockRestore();
    });
});
