import { sleep } from '../lib/util.js';

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/rate-limits',
    freeNote: 'Free tier available with model-specific RPM/RPD limits. Check AI Studio for your project limits.',
    supportsJsonMode: true
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    keyUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs/rate-limits',
    freeNote: 'Free plan: e.g. gpt-oss-120b at 30 RPM / 1,000 RPD / 8K TPM / 200K TPD (Oct 2026).',
    supportsJsonMode: true
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (free models)',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    keyUrl: 'https://openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/models?max_price=0',
    freeNote: 'Only models ending in :free are free. Free model availability and daily caps change; verify before relying on one.',
    supportsJsonMode: true,
    freeOnly: true
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral AI',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    keyUrl: 'https://console.mistral.ai/api-keys',
    docsUrl: 'https://docs.mistral.ai/deployment/laplateforme/tier/',
    freeNote: 'Free experiment tier has rate limits; paid tiers are never used automatically.',
    supportsJsonMode: true
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras Inference',
    kind: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    keyUrl: 'https://cloud.cerebras.ai/',
    docsUrl: 'https://inference-docs.cerebras.ai/support/rate-limits',
    freeNote: 'Free tier has daily token limits. Verify current limits in your Cerebras account.',
    supportsJsonMode: false
  },
  custom: {
    id: 'custom',
    label: 'Custom OpenAI-compatible endpoint',
    kind: 'openai',
    baseUrl: '',
    defaultModel: '',
    keyUrl: '',
    docsUrl: '',
    freeNote: 'Use only an endpoint you control. JobScout never purchases credits or enables billing.',
    supportsJsonMode: true
  }
};

export class AiError extends Error {
  constructor(message, { provider, status, code, quotaExhausted = false, retryAfter = null } = {}) {
    super(message);
    this.name = 'AiError';
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.quotaExhausted = quotaExhausted;
    this.retryAfter = retryAfter;
  }
}

function providerConfig(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new AiError(`Unknown AI provider: ${providerId}`, { provider: providerId });
  return provider;
}

function quotaError(provider, status, message, retryAfter) {
  return new AiError(message || 'The AI provider quota is exhausted.', {
    provider,
    status,
    code: 'QUOTA_EXHAUSTED',
    quotaExhausted: true,
    retryAfter
  });
}

const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const TRANSIENT_DELAYS_MS = [600, 1500];

export async function callAi({ providerId, model, apiKey, baseUrl, system, user, json = true, maxOutputTokens = 2500, timeoutMs = 90000 }) {
  const provider = providerConfig(providerId);
  if (!apiKey) throw new AiError('No API key configured for this provider.', { provider: providerId, code: 'NO_KEY' });
  const resolvedModel = String(model || provider.defaultModel || '').trim();
  if (!resolvedModel) throw new AiError('No model configured.', { provider: providerId, code: 'NO_MODEL' });
  const resolvedBase = String(baseUrl || provider.baseUrl || '').replace(/\/+$/, '');
  if (!resolvedBase) throw new AiError('No base URL configured for this provider.', { provider: providerId, code: 'NO_BASE_URL' });

  const options = { provider, providerId, resolvedModel, resolvedBase, apiKey, system, user, json, maxOutputTokens, timeoutMs };
  let lastError = null;
  for (let attempt = 0; attempt <= TRANSIENT_DELAYS_MS.length; attempt += 1) {
    try {
      return provider.kind === 'gemini'
        ? await callGemini(options)
        : await callOpenAiCompatible(options);
    } catch (error) {
      lastError = normalizeAiError(error, providerId);
      // A 5xx from a shared free tier is usually temporary; retry once or twice.
      if (attempt < TRANSIENT_DELAYS_MS.length && isTransientError(lastError)) {
        await sleep(TRANSIENT_DELAYS_MS[attempt]);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

function normalizeAiError(error, providerId) {
  if (error instanceof AiError) return error;
  if (error?.name === 'AbortError') {
    return new AiError('The AI request timed out. Try again or use a smaller batch.', { provider: providerId, code: 'TIMEOUT' });
  }
  return new AiError(`AI request failed: ${String(error?.message || error).slice(0, 240)}`, { provider: providerId, code: 'NETWORK' });
}

function isTransientError(error) {
  return error?.code === 'NETWORK' || TRANSIENT_STATUSES.has(Number(error?.status));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Gemini "thinking" tokens count against maxOutputTokens. With a small budget the
// whole reply can be consumed by reasoning, leaving empty or truncated JSON.
// Flash/Flash-Lite models support disabling it; Pro models do not, so leave them alone.
function geminiThinkingConfig(model) {
  const name = String(model).toLowerCase().replace(/^models\//, '');
  if (!name.startsWith('gemini-')) return null;
  return /^gemini-(?:2\.5|3(?:\.\d+)?)-(?:flash|flash-lite)/.test(name) ? { thinkingBudget: 0 } : null;
}

async function callGemini({ providerId, resolvedModel, resolvedBase, apiKey, system, user, json, maxOutputTokens, timeoutMs }) {
  const url = `${resolvedBase}/models/${encodeURIComponent(resolvedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const thinkingConfig = geminiThinkingConfig(resolvedModel);
  let includeSystem = Boolean(system);
  let includeThinking = Boolean(thinkingConfig);
  let includeJson = Boolean(json);
  let lastResponse = null;
  let lastData = null;

  // Some Gemini-compatible models reject systemInstruction, thinkingConfig or
  // responseMimeType. Drop the offending option and retry instead of failing the
  // whole request. This matters for the "gemini-*" family and custom proxies.
  for (let variant = 0; variant < 4; variant += 1) {
    const userText = includeSystem ? user : [system, user].filter(Boolean).join('\n\n');
    const body = {
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      ...(includeSystem ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens,
        ...(includeJson ? { responseMimeType: 'application/json' } : {}),
        ...(includeThinking ? { thinkingConfig } : {})
      }
    };
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }, timeoutMs);
    const data = await safeJson(response);
    if (response.ok) {
      const candidate = data?.candidates?.[0];
      const text = (candidate?.content?.parts || [])
        .filter((part) => part && !part.thought)
        .map((part) => part.text || '')
        .join('');
      if (!text) {
        const reason = candidate?.finishReason ? ` (finish reason: ${candidate.finishReason})` : '';
        throw new AiError(`The AI provider returned an empty response${reason}.`, { provider: providerId, status: response.status, code: 'EMPTY_RESPONSE' });
      }
      return {
        text,
        usage: {
          inputTokens: data?.usageMetadata?.promptTokenCount || 0,
          outputTokens: data?.usageMetadata?.candidatesTokenCount || 0
        },
        model: resolvedModel,
        provider: providerId
      };
    }

    lastResponse = response;
    lastData = data;
    if (response.status === 400) {
      const detail = JSON.stringify(data || {});
      if (includeSystem && /developer instruction|system[ _]?instruction/i.test(detail)) {
        includeSystem = false;
        continue;
      }
      if (includeThinking && /thinking|thought/i.test(detail)) {
        includeThinking = false;
        continue;
      }
      if (includeJson && /response[ _]?mime|json mode|response format/i.test(detail)) {
        includeJson = false;
        continue;
      }
    }
    throw errorFromResponse(providerId, response, data);
  }

  throw errorFromResponse(providerId, lastResponse, lastData);
}

function openAiMessageText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  return typeof message.text === 'string' ? message.text : '';
}

async function callOpenAiCompatible({ provider, providerId, resolvedModel, resolvedBase, apiKey, system, user, json, maxOutputTokens, timeoutMs }) {
  const url = `${resolvedBase}/chat/completions`;
  const body = {
    model: resolvedModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.15,
    max_tokens: maxOutputTokens,
    ...(json && provider.supportsJsonMode ? { response_format: { type: 'json_object' } } : {})
  };
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`
  };
  if (providerId === 'openrouter') {
    headers['http-referer'] = 'http://127.0.0.1:4317';
    headers['x-title'] = 'JobScout (local)';
  }
  let response = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs);
  let data = await safeJson(response);
  if (!response.ok && response.status === 400 && json && provider.supportsJsonMode && /response_format|json_object/i.test(JSON.stringify(data))) {
    delete body.response_format;
    response = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs);
    data = await safeJson(response);
  }
  if (!response.ok) throw errorFromResponse(providerId, response, data);
  const text = openAiMessageText(data?.choices?.[0]?.message) || data?.choices?.[0]?.text || '';
  if (!text) throw new AiError('The AI provider returned an empty response.', { provider: providerId, status: response.status, code: 'EMPTY_RESPONSE' });
  return {
    text: typeof text === 'string' ? text : JSON.stringify(text),
    usage: {
      inputTokens: data?.usage?.prompt_tokens || 0,
      outputTokens: data?.usage?.completion_tokens || 0
    },
    model: resolvedModel,
    provider: providerId
  };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    try {
      return { raw: await response.text() };
    } catch {
      return null;
    }
  }
}

function errorFromResponse(providerId, response, data) {
  const message = data?.error?.message || data?.message || data?.detail || `HTTP ${response.status}`;
  const text = `${message} ${JSON.stringify(data || {})}`.slice(0, 500);
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;
  if (response.status === 402 || /insufficient_quota|quota exceeded|exceeded your current quota|resource_exhausted|free tier|credit/i.test(text)) {
    return quotaError(providerId, response.status, `Free-tier quota appears exhausted: ${message}`, retryAfter);
  }
  if (response.status === 429) {
    return new AiError(`Rate limited by ${providerId}: ${message}`, {
      provider: providerId,
      status: 429,
      code: 'RATE_LIMITED',
      retryAfter
    });
  }
  if (response.status === 401 || response.status === 403) {
    return new AiError(`Authentication failed for ${providerId}. Check the API key and model access.`, {
      provider: providerId,
      status: response.status,
      code: 'AUTH'
    });
  }
  return new AiError(`${providerId} error ${response.status}: ${String(message).slice(0, 240)}`, {
    provider: providerId,
    status: response.status,
    code: 'HTTP_ERROR'
  });
}

export function parseJsonResponse(text) {
  if (!text) throw new AiError('Empty AI response.', { code: 'EMPTY_RESPONSE' });
  const raw = String(text).trim().replace(/^\uFEFF/, '');
  const candidates = [raw, raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()];
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed.ok) return parsed.value;
  }

  // Reasoning models sometimes wrap the answer in prose (or emit their own
  // braces while thinking). Scan for a balanced JSON value instead of assuming
  // the first "{" and the last "}" belong to the payload.
  for (let start = 0; start < raw.length; start += 1) {
    const char = raw[start];
    if (char !== '{' && char !== '[') continue;
    const end = balancedJsonEnd(raw, start);
    if (end < 0) continue;
    const parsed = tryParseJson(raw.slice(start, end + 1));
    if (parsed.ok) return parsed.value;
  }

  throw new AiError('The AI response was not valid JSON. The raw response was discarded.', { code: 'INVALID_JSON' });
}

function tryParseJson(value) {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false, value: undefined };
  }
}

function balancedJsonEnd(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export async function listModels({ providerId, apiKey, baseUrl }) {
  const provider = providerConfig(providerId);
  if (!apiKey) throw new AiError('Add an API key first.', { provider: providerId, code: 'NO_KEY' });
  const resolvedBase = String(baseUrl || provider.baseUrl || '').replace(/\/+$/, '');
  if (provider.kind === 'gemini') {
    const response = await fetch(`${resolvedBase}/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`);
    const data = await safeJson(response);
    if (!response.ok) throw errorFromResponse(providerId, response, data);
    return (data?.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || m.name }))
      .filter((m) => m.id);
  }
  const response = await fetch(`${resolvedBase}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  const data = await safeJson(response);
  if (!response.ok) throw errorFromResponse(providerId, response, data);
  return (data?.data || data?.models || [])
    .map((m) => ({ id: m.id || m.name, label: m.name || m.id }))
    .filter((m) => m.id);
}

export async function testProvider({ providerId, model, apiKey, baseUrl }) {
  const started = Date.now();
  const result = await callAi({
    providerId,
    model,
    apiKey,
    baseUrl,
    system: 'You are a connection test. Reply with exactly the JSON {"ok":true}.',
    user: 'Reply with {"ok":true}.',
    json: true,
    // Reasoning models spend tokens before emitting the JSON, so a tiny budget
    // truncates the reply and makes valid providers look broken (Groq then
    // reports "Failed to validate JSON").
    maxOutputTokens: 1024,
    timeoutMs: 30000
  });
  return {
    ok: true,
    latencyMs: Date.now() - started,
    model: result.model,
    usage: result.usage,
    reply: parseJsonResponse(result.text)
  };
}
