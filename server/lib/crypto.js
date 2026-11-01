import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALGO = 'aes-256-gcm';

export function loadOrCreateSecret(dataDir) {
  const file = path.join(dataDir, '.secret');
  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(file)) {
    const value = fs.readFileSync(file);
    if (value.length >= 32) return value.subarray(0, 32);
  }
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function encryptString(plain, secret) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, secret, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptString(payload, secret) {
  if (!payload) return null;
  try {
    const [version, ivB64, tagB64, dataB64] = String(payload).split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv(ALGO, secret, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function maskKey(key) {
  if (!key) return null;
  const text = String(key);
  if (text.length <= 8) return '••••••••';
  return `${text.slice(0, 3)}••••••••${text.slice(-2)}`;
}
