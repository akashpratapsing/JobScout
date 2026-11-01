import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const config = {
  root,
  publicDir: path.join(root, 'public'),
  dataDir: process.env.JOB_SCOUT_DATA_DIR || path.join(root, 'data'),
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 4317),
  version: '1.0.0',
  maxUploadBytes: 10 * 1024 * 1024,
  maxJsonBytes: 2 * 1024 * 1024,
  ai: {
    maxResumeChars: 18000,
    maxJobChars: 3500,
    jobsPerBatch: 4,
    maxJobsPerRun: 80,
    requestTimeoutMs: 90000
  },
  discovery: {
    requestTimeoutMs: 20000,
    maxPerBoard: 18,
    maxPerFeed: 60,
    hostDelayMs: 350,
    maxConcurrentRequests: 4,
    verifyPerRun: 12
  }
};
