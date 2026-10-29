import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { internalError, unprocessable } from './errors.js';

/**
 * Cryptographic helpers.
 *
 * Payment provider secrets are encrypted with AES-256-GCM before they touch the
 * database, so a database dump alone does not expose the ability to forge or
 * replay webhooks. The key lives only in the backend environment.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard
const AUTH_TAG_LENGTH = 16;
const ENCRYPTION_VERSION = 'v1';

function key(): Buffer {
  return Buffer.from(env.APP_ENCRYPTION_KEY, 'hex');
}

/** Returns "v1:<iv-b64>:<tag-b64>:<ciphertext-b64>". */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw unprocessable('Cannot encrypt an empty secret');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv, { authTagLength: AUTH_TAG_LENGTH });
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
    throw internalError('Stored secret is malformed or was encrypted with a different scheme');
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'), {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (cause) {
    // Wrong key, or the ciphertext was tampered with.
    throw internalError('Unable to decrypt stored secret', cause);
  }
}

/** Cryptographically random opaque token (hex). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/** SHA-256 hex. Used to store refresh tokens — the raw token never persists. */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/** HMAC-SHA256 hex, for provider webhook signatures. */
export function hmacSha256(secret: string, payload: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time comparison. Never compare signatures with `===`. */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length doesn't leak through timing.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function uuid(): string {
  return crypto.randomUUID();
}
