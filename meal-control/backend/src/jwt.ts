import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'meal-control-secret-mvp';

export interface QRPayload {
  registration: string;
  store_code: string;
}

export function signQR(payload: QRPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '365d' });
}

export function verifyQR(token: string): QRPayload {
  const decoded = jwt.verify(token, SECRET) as QRPayload & jwt.JwtPayload;
  if (!decoded.registration || !decoded.store_code) {
    throw new Error('Token inválido: campos obrigatórios ausentes');
  }
  return { registration: decoded.registration, store_code: decoded.store_code };
}
