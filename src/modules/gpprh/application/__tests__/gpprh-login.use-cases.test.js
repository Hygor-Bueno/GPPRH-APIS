const { GpprhLoginUseCases } = require('../gpprh-login.use-cases');
const { GpprhRepositoryPort } = require('../ports/gpprh-repository.port');
const { LdapAuthenticatorPort } = require('../ports/ldap-authenticator.port');
const { GoogleTokenVerifierPort } = require('../ports/google-token-verifier.port');

class FakeGpprhRepository extends GpprhRepositoryPort {}
class FakeLdapAuthenticator extends LdapAuthenticatorPort {}
class FakeGoogleTokenVerifier extends GoogleTokenVerifierPort {}

function buildUseCases(overrides = {}) {
    const repository = new FakeGpprhRepository();
    const ldapAuthenticator = new FakeLdapAuthenticator();
    const googleTokenVerifier = new FakeGoogleTokenVerifier();

    Object.assign(repository, overrides.repository);
    Object.assign(ldapAuthenticator, overrides.ldapAuthenticator);
    Object.assign(googleTokenVerifier, overrides.googleTokenVerifier);

    return new GpprhLoginUseCases({ repository, ldapAuthenticator, googleTokenVerifier });
}

describe('GpprhLoginUseCases', () => {
    describe('loginViaAd', () => {
        it('authenticates via LDAP, upserts the AD login, and returns the user payload', async () => {
            const authenticate = jest.fn().mockResolvedValue({ guid: 'guid-1', name: 'John Doe' });
            const spAdLogin = jest.fn().mockResolvedValue(undefined);
            const getUser = jest.fn().mockResolvedValue({ user_id: 1, name: 'John Doe' });

            const useCases = buildUseCases({
                ldapAuthenticator: { authenticate },
                repository: { spAdLogin, getUser },
            });

            const result = await useCases.loginViaAd('jdoe', 'secret');

            expect(authenticate).toHaveBeenCalledWith('jdoe', 'secret');
            expect(spAdLogin).toHaveBeenCalledWith('guid-1', 'John Doe');
            expect(getUser).toHaveBeenCalledWith('guid-1');
            expect(result).toEqual({ user_id: 1, name: 'John Doe' });
        });

        it('propagates LDAP authentication failures', async () => {
            const authenticate = jest.fn().mockRejectedValue(new Error('Invalid username or password'));
            const useCases = buildUseCases({ ldapAuthenticator: { authenticate } });

            await expect(useCases.loginViaAd('jdoe', 'wrong')).rejects.toThrow('Invalid username or password');
        });
    });

    describe('loginViaGoogle', () => {
        it('verifies the Google token, logs in as candidate, and stamps CANDIDATE role/permissions', async () => {
            const verify = jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane' });
            const spCandidateLogin = jest.fn().mockResolvedValue({ id: 5, name: 'Jane' });

            const useCases = buildUseCases({
                googleTokenVerifier: { verify },
                repository: { spCandidateLogin },
            });

            const result = await useCases.loginViaGoogle('some-jwt');

            expect(verify).toHaveBeenCalledWith('some-jwt');
            expect(spCandidateLogin).toHaveBeenCalledWith('Jane', 'jane@example.com');
            expect(result).toEqual({ id: 5, name: 'Jane', roles: 'CANDIDATE', permissions: 'CANDIDATE' });
        });

        it('throws when the verified payload has no email', async () => {
            const verify = jest.fn().mockResolvedValue({ name: 'Jane' });
            const useCases = buildUseCases({ googleTokenVerifier: { verify } });

            await expect(useCases.loginViaGoogle('some-jwt')).rejects.toThrow('Dados do Google inválidos.');
        });
    });
});
