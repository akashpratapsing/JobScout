import fs from 'node:fs';
import path from 'node:path';

const SECRET_PATTERNS = [
  [/(api[_-]?key|authorization|access[_-]?token|secret|password)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi, '$1=[REDACTED]'],
  [/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]'],
  [/gsk_[0-9A-Za-z]{20,}/g, '[REDACTED]'],
  [/sk-[0-9A-Za-z_-]{20,}/g, '[REDACTED]']
];

export function redact(value) {
  if (value == null) return value;
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return text;
}

export function createLogger(dataDir) {
  const logDir = path.join(dataDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const errorLog = path.join(logDir, 'source-errors.jsonl');
  const appLog = path.join(logDir, 'app.log');

  function write(file, line) {
    try {
      fs.appendFileSync(file, `${line}\n`, 'utf8');
    } catch {
      // Logging must never take down a search.
    }
  }

  return {
    info(message, meta) {
      const line = `[${new Date().toISOString()}] INFO ${message}${meta ? ` ${redact(meta)}` : ''}`;
      console.log(line);
      write(appLog, line);
    },
    warn(message, meta) {
      const line = `[${new Date().toISOString()}] WARN ${message}${meta ? ` ${redact(meta)}` : ''}`;
      console.warn(line);
      write(appLog, line);
    },
    error(message, meta) {
      const line = `[${new Date().toISOString()}] ERROR ${message}${meta ? ` ${redact(meta)}` : ''}`;
      console.error(line);
      write(appLog, line);
    },
    sourceError(record) {
      const safe = { at: new Date().toISOString(), ...record };
      if (safe.message) safe.message = redact(String(safe.message));
      write(errorLog, JSON.stringify(safe));
    }
  };
}
