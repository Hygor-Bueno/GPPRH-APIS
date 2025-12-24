// GoogleAuthService.ts
import { OAuth2Client } from "google-auth-library";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export class GoogleAuthService {
  static async login(credential) {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload?.email_verified) {
      throw new Error("Email não verificado pelo Google");
    }

    // 🔹 Regra de negócio
    // - busca/cria usuário
    // - vincula AD
    // - gera JWT
    // - retorna dados

    return {
      email: payload.email,
      name: payload.name,
    };
  }
}
