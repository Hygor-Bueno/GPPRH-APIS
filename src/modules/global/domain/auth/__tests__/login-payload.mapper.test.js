const {
    nicknameFromName,
    mapUserWithOrganization,
    REQUIRED_AUTHORIZATION_FIELDS,
} = require('../login-payload.mapper');

/**
 * Linha como `sp_get_user_authorization` devolve. Os campos obrigatórios ficam
 * aqui para que cada teste sobrescreva só o que lhe interessa — e para que
 * acrescentar um campo à procedure quebre um lugar só.
 */
function makeUserRow(overrides = {}) {
    return {
        id: 1,
        user: 'fulano',
        name: 'Fulano Silva',
        registration: '123',
        branch_code: '0101',
        ad_status: 'active',
        must_change_password: 0,
        application_ids: null,
        roles: null,
        permissions: null,
        ...overrides,
    };
}

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
            const user = makeUserRow({
                roles: 'ADMIN,USER', permissions: 'A,B,C', application_ids: '1,2,3',
            });
            const result = mapUserWithOrganization(user);
            expect(result.roles).toEqual(['ADMIN', 'USER']);
            expect(result.permissions).toEqual(['A', 'B', 'C']);
            expect(result.application_ids).toEqual([1, 2, 3]);
        });

        it('should default roles/permissions/application_ids to empty arrays when null', () => {
            // GROUP_CONCAT devolve NULL quando não há linhas — é resposta válida.
            const result = mapUserWithOrganization(makeUserRow());
            expect(result.roles).toEqual([]);
            expect(result.permissions).toEqual([]);
            expect(result.application_ids).toEqual([]);
        });

        it('should enrich with trimmed protheus organization data when present', () => {
            const orgData = {
                M0_CODIGO: ' 01 ', M0_NOMECOM: ' Acme ', M0_CODFIL: ' 0202 ', M0_FILIAL: ' Matriz ',
                CTT_CUSTO: ' CC1 ', CTT_DESC01: ' TI ',
            };
            const result = mapUserWithOrganization(makeUserRow(), orgData);
            expect(result.company_code).toBe('01');
            expect(result.company_name).toBe('Acme');
            expect(result.branch_code).toBe('0202');
            expect(result.branch_name).toBe('Matriz');
            expect(result.cost_center_code).toBe('CC1');
            expect(result.cost_center_description).toBe('TI');
        });

        it('should fall back to the mysql branch_code when protheus has none', () => {
            const result = mapUserWithOrganization(makeUserRow(), {});
            expect(result.branch_code).toBe('0101');
        });

        it('should default all organization fields to null when orgData is omitted', () => {
            const result = mapUserWithOrganization(makeUserRow());
            expect(result.company_code).toBeNull();
            expect(result.company_name).toBeNull();
            expect(result.branch_name).toBeNull();
            expect(result.cost_center_code).toBeNull();
            expect(result.cost_center_description).toBeNull();
        });

        describe('must_change_password', () => {
            it('should convert the TINYINT 1 to true', () => {
                // MySQL devolve TINYINT como número, não booleano.
                const result = mapUserWithOrganization(makeUserRow({ must_change_password: 1 }));
                expect(result.must_change_password).toBe(true);
            });

            it('should convert the TINYINT 0 to false', () => {
                const result = mapUserWithOrganization(makeUserRow({ must_change_password: 0 }));
                expect(result.must_change_password).toBe(false);
            });
        });

        describe('campos ausentes na procedure', () => {
            it.each(REQUIRED_AUTHORIZATION_FIELDS)(
                'deve lançar quando a procedure não devolve %s',
                field => {
                    const user = makeUserRow();
                    delete user[field];

                    // Sem isto o campo vira undefined e some sem erro: foi assim que
                    // must_change_password ficou false para todo mundo em 08/2026,
                    // desativando a troca de senha obrigatória por inteiro.
                    expect(() => mapUserWithOrganization(user)).toThrow(new RegExp(field));
                },
            );

            it('não deve lançar quando o campo existe com valor null', () => {
                // null é resposta legítima de GROUP_CONCAT; ausência da chave não é.
                expect(() => mapUserWithOrganization(makeUserRow({ permissions: null }))).not.toThrow();
            });
        });
    });
});
