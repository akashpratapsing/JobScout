import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, DEFAULT_PREFERENCES } from '../server/lib/store.js';
import { encryptString, decryptString, maskKey, loadOrCreateSecret } from '../server/lib/crypto.js';
import { redact, createLogger } from '../server/lib/logger.js';
import { tempDir } from './helpers.js';

test('Store initializes, persists, reloads and merges new defaults', async () => {
  const dir = tempDir();
  const store = await new Store(dir).init();
  assert.equal(fs.existsSync(path.join(dir, 'app.json')), true);
  assert.equal(store.get().profile, null);
  assert.deepEqual(store.get().preferences.countries, ['India']);

  await store.update((data) => {
    data.profile = { name: 'Aarav' };
    data.preferences.titles = ['Backend Engineer'];
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).profile.name, 'Aarav');
  assert.equal(fs.existsSync(path.join(dir, 'app.json.tmp')), false);

  // Simulate an older file that is missing newer preference keys.
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
  delete raw.preferences.maxAgeDays;
  fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify(raw));

  const reloaded = await new Store(dir).init();
  assert.equal(reloaded.get().profile.name, 'Aarav');
  assert.deepEqual(reloaded.get().preferences.titles, ['Backend Engineer']);
  assert.equal(reloaded.get().preferences.maxAgeDays, DEFAULT_PREFERENCES.maxAgeDays);
  assert.equal(fs.existsSync(path.join(dir, 'backups', `app-${new Date().toISOString().slice(0, 10)}.json`)), true);
});

test('Store export is a deep copy and reset restores defaults', async () => {
  const store = await new Store(tempDir()).init();
  await store.update((data) => {
    data.profile = { name: 'Aarav' };
    data.jobs.push({ id: '1' });
  });
  const exported = await store.export();
  exported.profile.name = 'Changed';
  exported.jobs.push({ id: '2' });
  assert.equal(store.get().profile.name, 'Aarav');
  assert.equal(store.get().jobs.length, 1);

  await store.reset();
  assert.equal(store.get().profile, null);
  assert.equal(store.get().jobs.length, 0);
});

test('AES-256-GCM encryption round-trips and rejects tampering', () => {
  const secret = loadOrCreateSecret(tempDir());
  const encrypted = encryptString('super-secret-key', secret);
  assert.match(encrypted, /^v1:/);
  assert.notEqual(encrypted, 'super-secret-key');
  assert.equal(decryptString(encrypted, secret), 'super-secret-key');
  assert.equal(encryptString('', secret), null);
  assert.equal(decryptString(null, secret), null);
  assert.equal(decryptString(encrypted, loadOrCreateSecret(tempDir())), null);

  const parts = encrypted.split(':');
  parts[3] = `${parts[3].slice(0, -4)}AAAA`;
  assert.equal(decryptString(parts.join(':'), secret), null);
});

test('the secret file is stable across loads', () => {
  const dir = tempDir();
  const first = loadOrCreateSecret(dir);
  const second = loadOrCreateSecret(dir);
  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
});

test('maskKey never reveals the full key', () => {
  assert.equal(maskKey(''), null);
  assert.equal(maskKey('short'), '••••••••');
  assert.equal(maskKey('abcdefghijklmnop'), 'abc••••••••op');
});

test('logger redacts common secret patterns and writes source errors', () => {
  assert.equal(redact('api_key=AIzaSyABCDEFGHIJKLMNOPQRSTUV'), 'api_key=[REDACTED]');
  const auth = redact('Authorization: Bearer gsk_abcdefghijklmnopqrstuvwxyz');
  assert.ok(!auth.includes('gsk_abcdefghijklmnopqrstuvwxyz'));
  assert.match(auth, /\[REDACTED\]/);
  assert.equal(redact('sk-abcdefghijklmnopqrstuvwxyz'), '[REDACTED]');
  assert.match(redact({ apiKey: 'abc' }), /\[REDACTED\]/);

  const dir = tempDir();
  const logger = createLogger(dir);
  logger.sourceError({ source: 'test', message: 'api_key=sk-abcdefghijklmnopqrstuvwxyz' });
  const file = path.join(dir, 'logs', 'source-errors.jsonl');
  assert.equal(fs.existsSync(file), true);
  const line = fs.readFileSync(file, 'utf8');
  assert.match(line, /\[REDACTED\]/);
  assert.ok(!line.includes('sk-abcdefghijklmnopqrstuvwxyz'));
});
