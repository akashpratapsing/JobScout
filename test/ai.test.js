import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PROVIDERS, AiError, callAi, parseJsonResponse, listModels, testProvider } from '../server/ai/providers.js';
import {
  getAiRuntime,
  isCoolingDown,
  recordAiSuccess,
  recordAiFailure,
  mergeResumeAnalysis,
  matchJobsWithAi
} from '../server/ai/analyze.js';
import { encryptString } from '../server/lib/crypto.js';
import { extractJobSignals } from '../server/matching/extract.js';
import { makeJob, makeProfile, makePreferences } from './helpers.js';

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function fakeStore(aiOverrides = {}) {
  const state = {
    settings: {
      ai: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKeyEnc: null,
        baseUrl: '',
        enabled: false,
        freeOnly: true,
        cooldownUntil: null,
        lastError: null,
        lastSuccessAt: null,
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        ...aiOverrides
      }
    }
  };
  return {
    state,
    get: () => state,
    update: async (mutator) => {
      await mutator(state);
      return state;
    }
  };
}

async function withFetch(mock, fn) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return mock(String(url), options, calls.length);
  };
  try {
    return await fn(calls);
  } finally {
    global.fetch = original;
  }
}

test('parseJsonResponse accepts plain JSON, fenced JSON and prose-wrapped JSON', () => {
  assert.deepEqual(parseJsonResponse('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonResponse('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonResponse('Here is the result:\n{"a":1}\nDone.'), { a: 1 });
  assert.throws(() => parseJsonResponse('not json at all'), (error) => error instanceof AiError && error.code === 'INVALID_JSON');
  assert.throws(() => parseJsonResponse(''), /Empty AI response/);
});

test('parseJsonResponse skips reasoning braces and brace characters inside strings', () => {
  const text = 'Let me think {not: json} first.\n{"ok":true,"note":"a } brace and { brace"}';
  assert.deepEqual(parseJsonResponse(text), { ok: true, note: 'a } brace and { brace' });
  assert.deepEqual(parseJsonResponse('prefix [1,2,3] suffix'), [1, 2, 3]);
});

test('callAi sends a Gemini request and parses usage', async () => {
  await withFetch(
    () => jsonResponse({
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 }
    }),
    async (calls) => {
      const result = await callAi({
        providerId: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'gem-key',
        system: 'system',
        user: 'user'
      });
      assert.equal(result.text, '{"ok":true}');
      assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 7 });
      assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent\?key=gem-key/);
      const body = JSON.parse(calls[0].options.body);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.equal(body.contents[0].parts[0].text, 'user');
    }
  );
});

test('callAi drops Gemini thought parts and disables thinking for Flash models', async () => {
  await withFetch(
    () => jsonResponse({
      candidates: [{
        content: { parts: [{ text: 'internal reasoning', thought: true }, { text: '{"ok":true}' }] },
        finishReason: 'STOP'
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 }
    }),
    async (calls) => {
      const result = await callAi({
        providerId: 'gemini',
        model: 'gemini-3.5-flash',
        apiKey: 'gem-key',
        system: 'system',
        user: 'user'
      });
      assert.equal(result.text, '{"ok":true}');
      const body = JSON.parse(calls[0].options.body);
      assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
    }
  );
});

test('callAi retries a Gemini request without systemInstruction when the model rejects it', async () => {
  await withFetch(
    (url, options, call) => {
      if (call === 1) {
        return jsonResponse({ error: { message: 'Developer instruction is not enabled for this model' } }, 400);
      }
      const body = JSON.parse(options.body);
      assert.equal(body.systemInstruction, undefined);
      assert.match(body.contents[0].parts[0].text, /system[\s\S]*user/);
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
    },
    async (calls) => {
      const result = await callAi({ providerId: 'gemini', model: 'gemini-3.5-flash', apiKey: 'key', system: 'system', user: 'user' });
      assert.equal(result.text, '{"ok":true}');
      assert.equal(calls.length, 2);
      assert.ok(JSON.parse(calls[0].options.body).systemInstruction);
    }
  );
});

test('callAi retries transient provider outages such as 503 high demand', async () => {
  await withFetch(
    (url, options, call) => {
      if (call === 1) return jsonResponse({ error: { message: 'This model is currently experiencing high demand.' } }, 503);
      return jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] });
    },
    async (calls) => {
      const result = await callAi({ providerId: 'groq', model: 'm', apiKey: 'key', system: 's', user: 'u' });
      assert.equal(result.text, '{"ok":true}');
      assert.equal(calls.length, 2);
    }
  );
});

test('callAi sends an OpenAI-compatible request with the bearer token', async () => {
  await withFetch(
    () => jsonResponse({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 }
    }),
    async (calls) => {
      const result = await callAi({
        providerId: 'groq',
        model: 'openai/gpt-oss-120b',
        apiKey: 'gsk_test_key_value',
        system: 'system',
        user: 'user'
      });
      assert.equal(result.text, '{"ok":true}');
      assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 3 });
      assert.match(calls[0].url, /api\.groq\.com\/openai\/v1\/chat\/completions/);
      assert.equal(calls[0].options.headers.authorization, 'Bearer gsk_test_key_value');
      const body = JSON.parse(calls[0].options.body);
      assert.equal(body.model, 'openai/gpt-oss-120b');
      assert.deepEqual(body.response_format, { type: 'json_object' });
    }
  );
});

test('callAi retries without JSON mode when a provider rejects response_format', async () => {
  await withFetch(
    (url, options, call) => {
      if (call === 1) return jsonResponse({ error: { message: 'response_format is not supported' } }, 400);
      const body = JSON.parse(options.body);
      assert.equal(body.response_format, undefined);
      return jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] });
    },
    async (calls) => {
      const result = await callAi({ providerId: 'mistral', model: 'mistral-small-latest', apiKey: 'key', system: 's', user: 'u' });
      assert.equal(result.text, '{"ok":true}');
      assert.equal(calls.length, 2);
    }
  );
});

test('callAi maps rate limits, quota exhaustion and auth failures to typed errors', async () => {
  await withFetch(
    () => jsonResponse({ error: { message: 'Too many requests' } }, 429, { 'retry-after': '120' }),
    async () => {
      await assert.rejects(
        () => callAi({ providerId: 'groq', model: 'm', apiKey: 'k', system: 's', user: 'u' }),
        (error) => error instanceof AiError && error.code === 'RATE_LIMITED' && error.retryAfter === 120
      );
    }
  );

  await withFetch(
    () => jsonResponse({ error: { message: 'You exceeded your current quota' } }, 429),
    async () => {
      await assert.rejects(
        () => callAi({ providerId: 'gemini', model: 'm', apiKey: 'k', system: 's', user: 'u' }),
        (error) => error instanceof AiError && error.quotaExhausted === true && error.code === 'QUOTA_EXHAUSTED'
      );
    }
  );

  await withFetch(
    () => jsonResponse({ error: { message: 'invalid key' } }, 401),
    async () => {
      await assert.rejects(
        () => callAi({ providerId: 'groq', model: 'm', apiKey: 'k', system: 's', user: 'u' }),
        (error) => error instanceof AiError && error.code === 'AUTH'
      );
    }
  );
});

test('callAi rejects missing keys, models, base URLs and empty responses', async () => {
  await assert.rejects(() => callAi({ providerId: 'gemini', apiKey: '', system: 's', user: 'u' }), /No API key/);
  await assert.rejects(() => callAi({ providerId: 'custom', apiKey: 'k', baseUrl: '', model: 'm', system: 's', user: 'u' }), /No base URL/);
  await assert.rejects(
    () => callAi({ providerId: 'custom', apiKey: 'k', baseUrl: 'https://example.com/v1', model: '', system: 's', user: 'u' }),
    /No model/
  );
  await withFetch(
    () => jsonResponse({ candidates: [] }),
    async () => {
      await assert.rejects(
        () => callAi({ providerId: 'gemini', model: 'm', apiKey: 'k', system: 's', user: 'u' }),
        (error) => error instanceof AiError && error.code === 'EMPTY_RESPONSE'
      );
    }
  );
});

test('listModels and testProvider use the configured endpoint', async () => {
  await withFetch(
    () => jsonResponse({ models: [
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }
    ] }),
    async () => {
      const models = await listModels({ providerId: 'gemini', apiKey: 'key' });
      assert.deepEqual(models, [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }]);
    }
  );

  await withFetch(
    () => jsonResponse({ data: [{ id: 'openai/gpt-oss-120b', name: 'GPT OSS' }] }),
    async () => {
      const models = await listModels({ providerId: 'groq', apiKey: 'key' });
      assert.deepEqual(models, [{ id: 'openai/gpt-oss-120b', label: 'GPT OSS' }]);
    }
  );

  await withFetch(
    () => jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }),
    async (calls) => {
      const result = await testProvider({ providerId: 'groq', model: 'm', apiKey: 'key' });
      assert.equal(result.ok, true);
      assert.deepEqual(result.reply, { ok: true });
      assert.equal(typeof result.latencyMs, 'number');
      const body = JSON.parse(calls[0].options.body);
      assert.ok(body.max_tokens >= 256, 'reasoning models need room before emitting JSON');
    }
  );
});

test('getAiRuntime requires both an enabled flag and a decryptable key', () => {
  const secret = crypto.randomBytes(32);
  const disabled = fakeStore({ apiKeyEnc: encryptString('key', secret), enabled: false });
  assert.equal(getAiRuntime(disabled, secret).enabled, false);

  const noKey = fakeStore({ enabled: true });
  assert.equal(getAiRuntime(noKey, secret).enabled, false);

  const enabled = fakeStore({ apiKeyEnc: encryptString('key', secret), enabled: true, model: '' });
  const runtime = getAiRuntime(enabled, secret);
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.apiKey, 'key');
  assert.equal(runtime.model, PROVIDERS.gemini.defaultModel);
});

test('recordAiSuccess and recordAiFailure track usage, cooldown and redact keys', async () => {
  const store = fakeStore();
  await recordAiSuccess(store, { inputTokens: 100, outputTokens: 50 });
  assert.equal(store.state.settings.ai.totalRequests, 1);
  assert.equal(store.state.settings.ai.totalInputTokens, 100);
  assert.equal(store.state.settings.ai.totalOutputTokens, 50);
  assert.ok(store.state.settings.ai.lastSuccessAt);

  await recordAiFailure(store, new AiError('quota for key abc123 exhausted', { quotaExhausted: true, retryAfter: 3600 }), 'abc123');
  assert.match(store.state.settings.ai.lastError, /\[REDACTED\]/);
  assert.ok(!store.state.settings.ai.lastError.includes('abc123'));
  assert.ok(new Date(store.state.settings.ai.cooldownUntil).getTime() > Date.now());
  assert.ok(isCoolingDown(store));

  await recordAiFailure(store, new AiError('rate limited', { code: 'RATE_LIMITED', retryAfter: 120 }), '');
  const until = new Date(store.state.settings.ai.cooldownUntil).getTime();
  assert.ok(until > Date.now() + 60 * 1000);
  assert.ok(until < Date.now() + 180 * 1000);
});

test('mergeResumeAnalysis combines AI fields with the heuristic fallback', () => {
  const heuristic = makeProfile({ rawText: 'resume text', links: { linkedin: 'https://linkedin.com/in/x', github: '', other: [] } });
  const merged = mergeResumeAnalysis(heuristic, {
    name: 'Aarav S.',
    skills: ['python', 'golang'],
    experienceYears: 6,
    experienceLevel: 'lead',
    experience: [{ title: 'Lead Engineer', company: 'Acme', start: '2021', end: 'Present', description: 'Go services', technologies: ['Go'] }],
    projects: [],
    education: [{ degree: 'M.Tech', institution: 'IIT', year: '2021' }],
    certifications: [],
    keywords: ['distributed systems'],
    suggestedTitles: ['Lead Backend Engineer'],
    links: { linkedin: '', github: 'https://github.com/x', other: [] }
  }, { provider: 'groq', model: 'openai/gpt-oss-120b' });

  assert.equal(merged.name, 'Aarav S.');
  assert.equal(merged.experienceYears, 6);
  assert.equal(merged.experienceLevel, 'lead');
  assert.ok(merged.skills.includes('Python'));
  assert.ok(merged.skills.includes('Go'));
  assert.ok(merged.skills.includes('AWS'), 'heuristic skills are preserved');
  assert.equal(merged.experience[0].title, 'Lead Engineer');
  assert.deepEqual(merged.projects, heuristic.projects, 'empty AI arrays fall back');
  assert.equal(merged.links.linkedin, 'https://linkedin.com/in/x');
  assert.equal(merged.links.github, 'https://github.com/x');
  assert.equal(merged.analysis.method, 'ai');
  assert.equal(merged.analysis.provider, 'groq');
  assert.equal(merged.rawText, 'resume text');
});

test('matchJobsWithAi batches jobs and applies conservative caps', async () => {
  const jobs = [
    makeJob({
      id: 'ai-job-1',
      title: 'Senior Backend Engineer',
      description: 'Requirements\n5+ years of experience with Python, AWS and Docker.\n\nNice to have\nKubernetes.',
      location: 'Bengaluru, India'
    }),
    makeJob({
      id: 'ai-job-2',
      title: 'Backend Engineer',
      description: 'Requirements\nPython and AWS required.',
      location: 'Bengaluru, India'
    })
  ];
  for (const job of jobs) job.signals = extractJobSignals(job);
  const store = fakeStore();
  const runtime = {
    enabled: true,
    providerId: 'groq',
    provider: PROVIDERS.groq,
    model: 'openai/gpt-oss-120b',
    apiKey: 'key',
    store
  };

  await withFetch(
    () => jsonResponse({
      choices: [{
        message: {
          content: JSON.stringify({
            matches: [
              { id: 'ai-job-1', score: 95, matchedRequired: ['Python', 'AWS', 'Docker'], missingRequired: [], requiredSkills: ['Python', 'AWS', 'Docker'], verdict: 'Strong fit', why: 'Matches the stack.' },
              { id: 'ai-job-2', score: 80, matchedRequired: ['Python'], missingRequired: ['AWS'], requiredSkills: ['Python', 'AWS'], verdict: 'One gap', why: 'Missing AWS.' }
            ]
          })
        }
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50 }
    }),
    async (calls) => {
      const progress = [];
      const result = await matchJobsWithAi({
        jobs,
        profile: makeProfile(),
        preferences: makePreferences({ countries: ['India'] }),
        runtime,
        onProgress: (value) => progress.push(value)
      });
      assert.equal(result.matches.size, 2);
      assert.equal(result.error, null);
      assert.equal(result.completed, 2);
      assert.equal(progress.length, 1);
      assert.equal(progress[0].completed, 2);

      const first = result.matches.get('ai-job-1').match;
      assert.equal(first.method, 'ai');
      assert.ok(first.score >= 80);
      assert.deepEqual(first.missingRequired, []);

      const second = result.matches.get('ai-job-2').match;
      assert.deepEqual(second.missingRequired, ['AWS']);
      assert.ok(second.score <= 82);
      assert.equal(calls.length, 1);
      assert.equal(store.state.settings.ai.totalRequests, 1);
    }
  );
});

test('matchJobsWithAi returns partial results when the provider fails mid-run', async () => {
  const job = makeJob({
    id: 'ai-job-3',
    description: 'Requirements\nPython and AWS required.',
    location: 'Bengaluru, India'
  });
  job.signals = extractJobSignals(job);
  const runtime = {
    enabled: true,
    providerId: 'groq',
    provider: PROVIDERS.groq,
    model: 'openai/gpt-oss-120b',
    apiKey: 'key',
    store: fakeStore()
  };

  await withFetch(
    () => jsonResponse({ error: { message: 'rate limit exceeded' } }, 429),
    async () => {
      const result = await matchJobsWithAi({
        jobs: [job],
        profile: makeProfile(),
        preferences: makePreferences({ countries: ['India'] }),
        runtime
      });
      assert.equal(result.matches.size, 0);
      assert.ok(result.error instanceof AiError);
      assert.equal(result.error.code, 'RATE_LIMITED');
      assert.equal(result.completed, 0);
    }
  );
});
