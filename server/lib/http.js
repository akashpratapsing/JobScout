import Busboy from 'busboy';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...securityHeaders(),
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

export function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { ...securityHeaders(), 'content-type': type, 'cache-control': 'no-store' });
  res.end(text);
}

export async function readJson(req, limit = config.maxJsonBytes) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > limit) throw new HttpError(413, 'Request body is too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

export function parseMultipart(req, { maxBytes = config.maxUploadBytes } = {}) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({ headers: req.headers, limits: { fileSize: maxBytes, files: 1, fields: 10 } });
    } catch (error) {
      reject(new HttpError(400, `Invalid upload request: ${error.message}`));
      return;
    }
    const files = [];
    const fields = {};
    let tooLarge = false;

    busboy.on('file', (field, stream, info) => {
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
      });
      stream.on('limit', () => { tooLarge = true; });
      stream.on('end', () => {
        files.push({
          field,
          filename: String(info.filename || 'resume').replace(/[\\/]/g, '_').slice(0, 180),
          mimeType: info.mimeType || 'application/octet-stream',
          buffer: Buffer.concat(chunks),
          size
        });
      });
    });
    busboy.on('field', (name, value) => {
      fields[name] = value;
    });
    busboy.on('finish', () => {
      if (tooLarge) reject(new HttpError(413, 'Resume is larger than 10 MB.'));
      else resolve({ files, fields });
    });
    busboy.on('error', (error) => reject(new HttpError(400, `Upload failed: ${error.message}`)));
    req.pipe(busboy);
  });
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = req.headers.host;
    const originUrl = new URL(origin);
    return originUrl.host === host && (originUrl.protocol === 'http:' || originUrl.protocol === 'https:');
  } catch {
    return false;
  }
}

export function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  };
}

export function queryList(url, name) {
  const value = url.searchParams.get(name);
  return value ? value.split(',').map((v) => v.trim()).filter(Boolean) : [];
}
