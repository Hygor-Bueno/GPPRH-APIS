const {
    isLockedUser, buildLockedScoreRow, buildScoreRow, sortScoreResults, EMPTY_SCORE,
} = require('../score-list.shaper');

describe('score-list.shaper', () => {
    describe('isLockedUser', () => {
        it('should return true for locked ids (3, 4)', () => {
            expect(isLockedUser(3)).toBe(true);
            expect(isLockedUser(4)).toBe(true);
        });

        it('should return false for other ids', () => {
            expect(isLockedUser(1)).toBe(false);
        });
    });

    describe('buildLockedScoreRow', () => {
        it('should mask every score field with the placeholder', () => {
            const row = buildLockedScoreRow({ id: 3, user: 'Admin' });
            expect(row.id).toBe(3);
            expect(row.user).toBe('Admin');
            expect(row.score).toBe('- 🔒 -');
            expect(row.disqualify_task_count).toBe('- 🔒 -');
        });
    });

    describe('buildScoreRow', () => {
        it('should merge id/user with the score fields', () => {
            const row = buildScoreRow({ id: 1, user: 'Fulano' }, { ...EMPTY_SCORE, score: 5 });
            expect(row).toEqual({ id: 1, user: 'Fulano', ...EMPTY_SCORE, score: 5 });
        });
    });

    describe('sortScoreResults', () => {
        it('should sort by score descending', () => {
            const results = [{ score: 1 }, { score: 5 }, { score: 3 }];
            expect(sortScoreResults(results).map(r => r.score)).toEqual([5, 3, 1]);
        });

        it('should push locked (string) scores to the end', () => {
            const results = [{ score: 5 }, { score: '- 🔒 -' }, { score: 10 }];
            expect(sortScoreResults(results).map(r => r.score)).toEqual([10, 5, '- 🔒 -']);
        });

        it('should not mutate the original array', () => {
            const results = [{ score: 1 }, { score: 5 }];
            const sorted = sortScoreResults(results);
            expect(sorted).not.toBe(results);
            expect(results[0].score).toBe(1);
        });
    });
});
