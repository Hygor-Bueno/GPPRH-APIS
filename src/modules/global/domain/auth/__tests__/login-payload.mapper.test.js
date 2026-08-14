const { nicknameFromName, mapUserWithOrganization } = require('../login-payload.mapper');

describe('login-payload.mapper', () => {
    describe('nicknameFromName', () => {
        it('should return null for a falsy name', () => {
            expect(nicknameFromName(null)).toBeNull();
            expect(nicknameFromName('')).toBeNull();
        });

        it('should return the first name alone when there is only one word', () => {
            expect(nicknameFromName('Fulano')).toBe('Fulano');
        });

        it('should return first + last name for multi-word names', () => {
            expect(nicknameFromName('Fulano de Tal Silva')).toBe('Fulano Silva');
        });
    });

    describe('mapUserWithOrganization', () => {
        it('should split roles/permissions/application_ids from csv strings', () => {
            const user = {
                id: 1, user: 'fulano', name: 'Fulano Silva', registration: '123', ad_status: 'active',
                roles: 'ADMIN,USER', permissions: 'A,B,C', application_ids: '1,2,3', branch_code: '0101',
            };
            const result = mapUserWithOrganization(user);
            expect(result.roles).toEqual(['ADMIN', 'USER']);
            expect(result.permissions).toEqual(['A', 'B', 'C']);
            expect(result.application_ids).toEqual([1, 2, 3]);
        });

        it('should default roles/permissions/application_ids to empty arrays when absent', () => {
            const user = { id: 1, user: 'fulano', name: 'Fulano', registration: '123', ad_status: 'active', branch_code: '0101' };
            const result = mapUserWithOrganization(user);
            expect(result.roles).toEqual([]);
            expect(result.permissions).toEqual([]);
            expect(result.application_ids).toEqual([]);
        });

        it('should enrich with trimmed protheus organization data when present', () => {
            const user = { id: 1, user: 'fulano', name: 'Fulano', registration: '123', ad_status: 'active', branch_code: '0101' };
            const orgData = {
                M0_CODIGO: ' 01 ', M0_NOMECOM: ' Acme ', M0_CODFIL: ' 0202 ', M0_FILIAL: ' Matriz ',
                CTT_CUSTO: ' CC1 ', CTT_DESC01: ' TI ',
            };
            const result = mapUserWithOrganization(user, orgData);
            expect(result.company_code).toBe('01');
            expect(result.company_name).toBe('Acme');
            expect(result.branch_code).toBe('0202');
            expect(result.branch_name).toBe('Matriz');
            expect(result.cost_center_code).toBe('CC1');
            expect(result.cost_center_description).toBe('TI');
        });

        it('should fall back to the mysql branch_code when protheus has none', () => {
            const user = { id: 1, user: 'fulano', name: 'Fulano', registration: '123', ad_status: 'active', branch_code: '0101' };
            const result = mapUserWithOrganization(user, {});
            expect(result.branch_code).toBe('0101');
        });

        it('should default all organization fields to null when orgData is omitted', () => {
            const user = { id: 1, user: 'fulano', name: 'Fulano', registration: '123', ad_status: 'active', branch_code: '0101' };
            const result = mapUserWithOrganization(user);
            expect(result.company_code).toBeNull();
            expect(result.company_name).toBeNull();
            expect(result.branch_name).toBeNull();
            expect(result.cost_center_code).toBeNull();
            expect(result.cost_center_description).toBeNull();
        });
    });
});
