const {
    buildOverviewWhere, buildTaskOverviewQuery, buildTaskOverviewSummaryQuery, escapeLike,
} = require('../gtpp-task-overview.queries');
const { normalizeOverviewFilters, CLOSED_STATES } = require('../../../domain/gtpp/task-overview/task-overview-filter.rules');

const filtersOf = (query) => normalizeOverviewFilters(query);
const placeholders = (sql) => (sql.match(/\?/g) || []).length;

describe('buildOverviewWhere', () => {
    it('should produce no WHERE at all without filters (supervision sees every task)', () => {
        expect(buildOverviewWhere(filtersOf({}), CLOSED_STATES)).toEqual({ where: '', params: [] });
    });

    it('should match creator OR member when user_role is any', () => {
        const { where, params } = buildOverviewWhere({ ...filtersOf({}), userIds: [7, 8] }, CLOSED_STATES);
        expect(where).toBe('WHERE (t.user_id IN (?, ?) OR EXISTS (SELECT 1 FROM gt_task_user fu WHERE fu.task_id = t.id AND fu.user_id IN (?, ?)))');
        expect(params).toEqual([7, 8, 7, 8]);
    });

    it('should only check gt_task.user_id for creator', () => {
        const { where, params } = buildOverviewWhere({ ...filtersOf({ user_id: '7', user_role: 'creator' }), userIds: [7] }, CLOSED_STATES);
        expect(where).toBe('WHERE t.user_id IN (?)');
        expect(params).toEqual([7]);
    });

    it('should filter the creator company by the branch prefix', () => {
        const { where, params } = buildOverviewWhere(filtersOf({ company_code: '02' }), CLOSED_STATES);
        expect(where).toBe('WHERE u.branch_code LIKE ?');
        expect(params).toEqual(['02%']);
    });

    it('should use the exact branch (and skip the company prefix) when a branch is given', () => {
        const { where, params } = buildOverviewWhere(filtersOf({ company_code: '02', branch_code: '0201' }), CLOSED_STATES);
        expect(where).toBe('WHERE u.branch_code = ?');
        expect(params).toEqual(['0201']);
    });

    it('should match the creator against the cost center members resolved in Protheus', () => {
        const filters = {
            ...filtersOf({ company_code: '02', cost_center_code: '1001' }),
            creatorPairs: [{ registration: '000001', branchCode: '0201' }, { registration: '000002', branchCode: '0209' }],
        };
        const { where, params } = buildOverviewWhere(filters, CLOSED_STATES);
        expect(where).toContain('(TRIM(u.registration), u.branch_code) IN ((?, ?), (?, ?))');
        expect(params).toEqual(['02%', '000001', '0201', '000002', '0209']);
    });

    it('should exclude closed states when overdue', () => {
        const { where, params } = buildOverviewWhere(filtersOf({ overdue: 'true' }), CLOSED_STATES);
        expect(where).toContain('t.final_date < CURDATE() AND t.state_id NOT IN (?, ?, ?)');
        expect(params).toEqual(CLOSED_STATES);
    });

    it('should keep placeholders and params aligned with every filter combined', () => {
        const { where, params } = buildOverviewWhere({
            ...filtersOf({
                user_id: '1', company_code: '01', branch_code: '0101', cost_center_code: '9',
                state_ids: '1,2', priority: '2', search: 'x', due_from: '2026-01-01', due_to: '2026-02-01', overdue: '1',
            }),
            userIds: [1],
            creatorPairs: [{ registration: '1', branchCode: '0101' }],
        }, CLOSED_STATES);
        expect(placeholders(where)).toBe(params.length);
    });
});

describe('escapeLike', () => {
    it('should escape LIKE wildcards so the search is literal', () => {
        expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
    });
});

describe('buildTaskOverviewQuery', () => {
    it('should fetch limit + 1 rows with the page offset', () => {
        const { sql } = buildTaskOverviewQuery(filtersOf({ page: '3', limit: '20' }), CLOSED_STATES);
        expect(sql).toContain('LIMIT 21 OFFSET 40');
    });

    it('should not join the per-user theme', () => {
        const { sql } = buildTaskOverviewQuery(filtersOf({}), CLOSED_STATES);
        expect(sql).not.toContain('gt_theme');
    });
});

describe('sqlEmployeesByCostCenter (Protheus)', () => {
    const { sqlEmployeesByCostCenter } = require('../../../../protheus/repositories/cost-center.queries');

    it('should read only the SRA table of the given company', () => {
        const sql = sqlEmployeesByCostCenter('06');
        expect(sql).toContain('TMPPRD12.dbo.SRA060');
        expect(sql).not.toContain('@branch_code');
    });

    it('should add the branch filter only when asked', () => {
        expect(sqlEmployeesByCostCenter('02', true)).toContain('RH.RA_FILIAL = @branch_code');
    });

    it('should return null for a company without a table (04, 05) or unknown input', () => {
        expect(sqlEmployeesByCostCenter('04')).toBeNull();
        expect(sqlEmployeesByCostCenter("02; DROP TABLE x")).toBeNull();
    });
});

describe('buildTaskOverviewSummaryQuery', () => {
    it('should reuse the same filters and not paginate', () => {
        const { sql, params } = buildTaskOverviewSummaryQuery(filtersOf({ state_ids: '1,2', page: '5' }), CLOSED_STATES);
        expect(sql).toContain('GROUP BY ts.id');
        expect(sql).not.toContain('LIMIT');
        expect(params).toEqual([1, 2]);
    });
});
