const { buildOrgKey, buildOrgMap, mergeUsersWithOrganization } = require('../user-organization.shaper');

describe('user-organization.shaper', () => {
    describe('buildOrgKey', () => {
        it('should pair registration and branch_code, trimmed', () => {
            expect(buildOrgKey(' 123 ', ' 0101 ')).toBe('123|0101');
        });
    });

    describe('buildOrgMap', () => {
        it('should index protheus rows by registration+branch_code', () => {
            const map = buildOrgMap([{ registration: '123', branch_code: '0101', company_name: 'Acme' }]);
            expect(map.get('123|0101').company_name).toBe('Acme');
        });
    });

    describe('mergeUsersWithOrganization', () => {
        it('should exclude users with a dismissal date in protheus', () => {
            const orgMap = buildOrgMap([{ registration: '123', branch_code: '0101', ra_demissa: '2026-01-01' }]);
            const users = [{ id: 1, registration: '123', branch_code: '0101' }];
            expect(mergeUsersWithOrganization(users, orgMap)).toHaveLength(0);
        });

        it('should keep users without a dismissal date and enrich them', () => {
            const orgMap = buildOrgMap([{
                registration: '123', branch_code: '0101', ra_demissa: '',
                company_code: '01', company_name: 'Acme', branch_name: 'Matriz',
                cnpj: '111', cost_center_code: 'CC1', cost_center_description: 'TI',
            }]);
            const users = [{ id: 1, name: 'Fulano', registration: '123', status: 1, file_id: 5, branch_code: '0101' }];

            const result = mergeUsersWithOrganization(users, orgMap);

            expect(result).toEqual([{
                id: 1, name: 'Fulano', registration: '123', status: 1, file_id: 5, branch_code: '0101',
                company_code: '01', company_name: 'Acme', branch_name: 'Matriz',
                cnpj: '111', cost_center_code: 'CC1', cost_center_description: 'TI',
            }]);
        });

        it('should keep users not found in protheus, with null org fields', () => {
            const users = [{ id: 2, name: 'Ciclano', registration: '999', status: 1, file_id: null, branch_code: '0202' }];
            const result = mergeUsersWithOrganization(users, new Map());
            expect(result[0]).toEqual({
                id: 2, name: 'Ciclano', registration: '999', status: 1, file_id: null, branch_code: '0202',
                company_code: null, company_name: null, branch_name: null,
                cnpj: null, cost_center_code: null, cost_center_description: null,
            });
        });
    });
});
