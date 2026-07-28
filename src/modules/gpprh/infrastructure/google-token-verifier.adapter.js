const { OAuth2Client } = require('google-auth-library');
const { AppError } = require('../../../errors/app.error');
const { GoogleTokenVerifierPort } = require('../application/ports/google-token-verifier.port');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * @implements {GoogleTokenVerifierPort}
 */
class GoogleTokenVerifierAdapter extends GoogleTokenVerifierPort {
    async verify(credential) {
        if (!credential) {
            throw new AppError('Google credential not provided', 400, { code: 'GOOGLE_CREDENTIAL_MISSING' });
        }

        let ticket;
        try {
            ticket = await client.verifyIdToken({
                idToken: credential,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
        } catch (err) {
            throw new AppError('Invalid or expired Google token', 401, { code: 'GOOGLE_TOKEN_INVALID' });
        }

        const payload = ticket.getPayload();

        if (!payload) {
            throw new AppError('Unable to retrieve Google token payload', 502, { code: 'GOOGLE_PAYLOAD_EMPTY' });
        }

        if (!payload.email_verified) {
            throw new AppError('Google account email is not verified', 403, { code: 'GOOGLE_EMAIL_NOT_VERIFIED' });
        }

        if (!payload.email || !payload.name) {
            throw new AppError('Incomplete Google account information', 422, {
                code: 'GOOGLE_PROFILE_INCOMPLETE',
                details: { email: payload.email, name: payload.name }
            });
        }

        return { email: payload.email, name: payload.name };
    }
}

module.exports = { GoogleTokenVerifierAdapter };
