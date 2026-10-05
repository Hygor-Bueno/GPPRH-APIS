const { normalizeOverviewFilters, MAX_LIMIT } = require('../task-overview-filter.rules');
const { AppError } = require('../../../../../../errors/app.error');

describe('normalizeOverviewFilters', () => {
    it('should return defaults when no filter is given', () => {
        expect(normalizeOverviewFilters({})).toEqual({
            userId: null, employeeRegistration: null, employeeBranch: null, userRole: 'any',
            companyCode: null, branchCode: null, costCenterCode: null,
            stateIds: [], priority: null, search: null,
            dueFrom: null, dueTo: null, overdue: false,
            page: 1, limit: 50,
        });
    });

    it('should parse and trim every filter', () => {
        const f = normalizeOverviewFilters({
            user_id: '10', user_role: 'CREATOR',
            company_code: ' 01 ', branch_code: '0101', cost_center_code: '1001',
            state_ids: '1, 2,2,3', priority: '0', search: '  inventário ',
            due_from: '2026-01-01', due_to: '2026-12-31', overdue: 'true',
            page: '3', limit: '20',
        });
        expect(f).toMatchObject({
            userId: 10, userRole: 'creator',
            companyCode: '01', branchCode: '0101', costCenterCode: '1001',
            stateIds: [1, 2, 3], priority: 0, search: 'inventário',
            dueFrom: '2026-01-01', dueTo: '2026-12-31', overdue: true,
            page: 3, limit: 20,
        });
    });

    it('should cap limit at MAX_LIMIT', () => {
        expect(normalizeOverviewFilters({ limit: '5000' }).limit).toBe(MAX_LIMIT);
    });

    it('should derive the company from the branch prefix', () => {
        expect(normalizeOverviewFilters({ branch_code: '0601' })).toMatchObject({ companyCode: '06', branchCode: '0601' });
    });

    it('should accept a cost center when only the branch is given', () => {
        expect(normalizeOverviewFilters({ branch_code: '0201', cost_center_code: '1001' }))
            .toMatchObject({ companyCode: '02', branchCode: '0201', costCenterCode: '1001' });
    });

    it('should reject a branch that does not belong to the company', () => {
        expect(() => normalizeOverviewFilters({ company_code: '01', branch_code: '0201' })).toThrow(/não pertence/);
    });

    it('should require a company (or branch) for the cost center', () => {
        expect(() => normalizeOverviewFilters({ cost_center_code: '1001' })).toThrow(/exige 'company_code' ou 'branch_code'/);
    });

    it('should accept the Protheus employee as registration + branch', () => {
        expect(normalizeOverviewFilters({ employee_registration: ' 000123 ', employee_branch: '0201', user_role: 'member' }))
            .toMatchObject({ employeeRegistration: '000123', employeeBranch: '0201', userRole: 'member', userId: null });
    });

    it.each([
        [{ employee_registration: '000123' }],
        [{ employee_branch: '0201' }],
    ])('should require registration and branch together (%o)', (query) => {
        expect(() => normalizeOverviewFilters(query)).toThrow(/devem ser enviados juntos/);
    });

    it('should not accept user_id and employee at the same time', () => {
        expect(() => normalizeOverviewFilters({ user_id: '1', employee_registration: '000123', employee_branch: '0201' }))
            .toThrow(/não os dois/);
    });

    it('should require user_id when user_role is not "any"', () => {
        expect(() => normalizeOverviewFilters({ user_role: 'member' })).toThrow(/exige 'user_id' ou 'employee_registration'/);
    });

    it.each([
        [{ user_id: 'abc' }],
        [{ user_id: '-1' }],
        [{ user_role: 'boss', user_id: '1' }],
        [{ company_code: "01' OR 1=1" }],
        [{ company_code: '1' }],
        [{ branch_code: '101' }],
        [{ company_code: '01', cost_center_code: '10-01' }],
        [{ state_ids: '1,x' }],
        [{ state_ids: '1,2,3,4,5,6,7,8,9,10,11' }],
        [{ due_from: '01/02/2026' }],
        [{ due_from: '2026-12-31', due_to: '2026-01-01' }],
        [{ overdue: 'sim' }],
        [{ page: '0' }],
        [{ search: 'x'.repeat(101) }],
    ])('should reject invalid input %o with 400', (query) => {
        try {
            normalizeOverviewFilters(query);
            throw new Error('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(AppError);
            expect(error.statusCode).toBe(400);
        }
    });
});
