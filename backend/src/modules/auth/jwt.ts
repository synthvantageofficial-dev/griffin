/** JWT signing/verification (HS256) for user sessions. */
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

const EXPIRES_IN = '30d';

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: EXPIRES_IN });
}

/** Returns the userId if the token is valid, else null. */
export function verifyToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'object' && decoded && typeof decoded.sub === 'string') {
      return decoded.sub;
    }
    return null;
  } catch {
    return null;
  }
}
