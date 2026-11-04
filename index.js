/**
 * EZAgent host half.
 *
 * Two jobs live here:
 *
 * 1. The EZCloud gateway answers its real responses without CORS headers (only
 *    preflight `OPTIONS` carries them), so a browser cannot call it directly
 *    from the DSH page. This half performs sign-in, account reads, and the
 *    model catalog over Node's network stack and exposes them at
 *    `/ezagent/ezcloud/*`, which the page reaches same-origin (the desktop
 *    shell forwards `dsh-app://app/…` to this server).
 *
 * 2. It registers an `ezcloud` provider with the host LLM registry, so the
 *    account's models show up in DSH's own model picker and stream through the
 *    OpenAI-compatible endpoint at `/v1/chat/completions`. Before sign-in the
 *    provider advertises no models, which makes the group disappear from the
 *    picker entirely.
 */

/**
 * The harness resolves `@deepseek-ai/*` for profile plugins, but a plugin that
 * is linked from outside the profile's `node_modules` may run where that
 * routing table is absent (for example when the entry is imported by a plain
 * Node tool). The dynamic import keeps the plugin loadable either way: with the
 * harness present we reuse its `LlmAdapter`/`LlmError` identity, and otherwise
 * the local definitions below keep the provider contract intact.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let LlmAdapterBase = class LlmAdapter {
  providerInfo(provider) {
    return { id: provider, name: provider };
  }

  listModels() {
    return Promise.resolve([]);
  }

  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: model });
  }

  async prepareCall(provider, model, signal) {
    return { model: await this.resolveModel(provider, model, signal), stream: (options) => this.stream(options) };
  }
};
let LlmErrorClass = class LlmError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = 'LlmError';
    this.code = code;
  }
};
let attribution = () => ({});
try {
  const dshLlm = await import('@deepseek-ai/dsh-llm');
  if (typeof dshLlm.LlmAdapter === 'function') LlmAdapterBase = dshLlm.LlmAdapter;
  if (typeof dshLlm.LlmError === 'function') LlmErrorClass = dshLlm.LlmError;
  if (typeof dshLlm.attributionHeaders === 'function') attribution = dshLlm.attributionHeaders;
} catch {
  // Standalone load: the fallbacks above already satisfy the adapter contract.
}

const LlmAdapter = LlmAdapterBase;
const LlmError = LlmErrorClass;
const attributionHeaders = attribution;

const PLUGIN_VERSION = '1.5.4';
const EZCLOUD_BASE_URL = 'https://api.ezstartai.com';
const API_KEY_NAME = 'EZAgent';
const ROUTE_PREFIX = '/ezagent/ezcloud';
const PROVIDER_ID = 'ezcloud';
const PROVIDER_NAME = 'EZCloud';
const CHAT_PATH = '/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 64 * 1024;
const MODEL_CACHE_MS = 60 * 1000;
const STATUS_CACHE_MS = 5 * 60 * 1000;
const PRICING_CACHE_MS = 10 * 60 * 1000;
const DEFAULT_CONTEXT_WINDOW = 131072;
const DEFAULT_MAX_TOKENS = 32768;
/**
 * Reasoning levels the gateway accepts. Sending anything else makes it reroute
 * the request to a different model without an error, so this list is also the
 * whitelist used when building the request body.
 */
const REASONING_EFFORTS = [
  { id: 'low', name: '低' },
  { id: 'medium', name: '中' },
  { id: 'high', name: '高' },
];
const DEFAULT_REASONING_EFFORT = 'high';
const REASONING_EFFORT_IDS = new Set(REASONING_EFFORTS.map((effort) => effort.id));
const IMAGE_PIXEL_BUDGET = 4194304;
const IMAGE_BYTE_BUDGET = 1048576;

/** Session the client last announced, mirrored to disk so the provider survives a restart. */
let liveSession = null;
let modelCache = { key: '', at: 0, entries: [] };
let statusCache = { at: 0, creditsPerUsd: 500, quotaPerUnit: 500000 };
let pricingCache = { at: 0, rows: [], vendors: new Map() };

const DSH_HOME = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh');
const SESSION_FILE = join(DSH_HOME, 'ezagent-session.json');
const DIAG_FILE = join(DSH_HOME, 'ezagent-diag.log');
const DIAG_LIMIT_BYTES = 32 * 1024;

/**
 * Append one bounded diagnostic line. Support for "the picker shows nothing"
 * needs to know whether the provider registered and what the catalog returned,
 * and neither is observable from the page.
 */
function trace(line) {
  try {
    mkdirSync(DSH_HOME, { recursive: true });
    try {
      if (statSync(DIAG_FILE).size > DIAG_LIMIT_BYTES) writeFileSync(DIAG_FILE, '');
    } catch {
      /* first write, or the file is unreadable */
    }
    writeFileSync(DIAG_FILE, `${new Date().toISOString()} ${line}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
  } catch {
    /* diagnostics are optional */
  }
}

/** Mirror the announced session so the model picker works before the page re-syncs. */
function persistSessionFile(session) {
  try {
    mkdirSync(DSH_HOME, { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify(session), { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* a read-only home only costs the early-startup catalog */
  }
}

function readSessionFile() {
  try {
    const parsed = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
    return normalizeSession(parsed);
  } catch {
    return null;
  }
}

function forgetSessionFile() {
  try {
    rmSync(SESSION_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return parsed !== null && typeof parsed === 'object' ? parsed : {};
}

async function ezcloudRequest(path, init) {
  let response;
  try {
    response = await fetch(`${EZCLOUD_BASE_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`无法连接 ${EZCLOUD_BASE_URL}，请检查本机网络`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return body;
}

function failureMessage(body, fallback) {
  if (body !== null && typeof body === 'object') {
    if (typeof body.message === 'string' && body.message.trim() !== '') return body.message.trim();
    if (body.error !== null && typeof body.error === 'object' && typeof body.error.message === 'string') {
      return body.error.message;
    }
  }
  return fallback;
}

function requireSuccess(body, fallback) {
  if (body === null || typeof body !== 'object' || body.success !== true) {
    throw new Error(failureMessage(body, fallback));
  }
  return body;
}

function bearer(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function listTokens(accessToken) {
  const body = requireSuccess(
    await ezcloudRequest('/api/token/?p=1&page_size=100', { headers: bearer(accessToken) }),
    '无法读取账号密钥列表',
  );
  const page = body.data !== null && typeof body.data === 'object' ? body.data : {};
  return Array.isArray(page.items) ? page.items : [];
}

/** Find the long-lived `EZAgent` token, creating it once when the account has none. */
async function ensureApiKey(accessToken) {
  const pick = (tokens) =>
    tokens.find((token) => token !== null && typeof token === 'object' && token.name === API_KEY_NAME) || null;

  let token = pick(await listTokens(accessToken));
  if (token === null) {
    requireSuccess(
      await ezcloudRequest('/api/token/', {
        method: 'POST',
        headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: API_KEY_NAME,
          unlimited_quota: true,
          expired_time: -1,
          remain_quota: 0,
        }),
      }),
      '无法在该账号下创建 EZAgent 密钥',
    );
    token = pick(await listTokens(accessToken));
    if (token === null) throw new Error('无法在该账号下创建 EZAgent 密钥');
  }

  const revealed = requireSuccess(
    await ezcloudRequest(`/api/token/${token.id}/key`, { method: 'POST', headers: bearer(accessToken) }),
    '无法读取 EZCloud 密钥',
  );
  const key =
    revealed.data !== null && typeof revealed.data === 'object' && typeof revealed.data.key === 'string'
      ? revealed.data.key
      : '';
  if (key === '') throw new Error('无法读取 EZCloud 密钥');
  return { id: typeof token.id === 'number' ? token.id : 0, key };
}

async function signIn(payload) {
  const account = String(payload.account === undefined || payload.account === null ? '' : payload.account).trim();
  const password = String(payload.password === undefined || payload.password === null ? '' : payload.password);
  if (account === '') throw new Error('请输入账号');
  if (password === '') throw new Error('请输入密码');

  // Phone numbers take the `phone` branch of /api/user/login; anything else is
  // a username. Sending both makes the server pick the phone path.
  const credentials = /^\+?[\d\s-]{6,}$/.test(account)
    ? { phone: account.replace(/[\s-]/g, ''), password }
    : { username: account, password };

  const body = await ezcloudRequest('/api/user/login?turnstile=', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  if (body === null || typeof body !== 'object' || body.success !== true) {
    throw new Error(failureMessage(body, '登录失败，请检查账号与密码'));
  }
  const data = body.data !== null && typeof body.data === 'object' ? body.data : {};
  if (data.require_verification === true) throw new Error('该账号已开启二次验证，请先在 EZCloud 网页端完成验证');
  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  if (accessToken === '') throw new Error('登录响应中缺少访问令牌');

  const user = data.user !== null && typeof data.user === 'object' ? data.user : {};
  const issued = await ensureApiKey(accessToken);
  return {
    version: 1,
    baseUrl: EZCLOUD_BASE_URL,
    userId: typeof user.id === 'number' ? user.id : 0,
    username: typeof user.username === 'string' ? user.username : account,
    displayName: typeof user.display_name === 'string' ? user.display_name : '',
    group: typeof user.group === 'string' ? user.group : '',
    accessToken,
    accessExpiresAt: typeof data.access_expires_at === 'number' ? data.access_expires_at : 0,
    deviceKey: typeof data.device_key === 'string' ? data.device_key : '',
    sessionSid:
      data.session !== null && typeof data.session === 'object' && typeof data.session.sid === 'string'
        ? data.session.sid
        : '',
    apiKey: issued.key,
    apiKeyId: issued.id,
    apiKeyName: API_KEY_NAME,
    signedInAt: Date.now(),
  };
}

/** Revoke the device key the login issued; the local session is dropped either way. */
async function signOut(payload) {
  const deviceKey = typeof payload.deviceKey === 'string' ? payload.deviceKey : '';
  if (deviceKey === '') return { revoked: false };
  try {
    await ezcloudRequest('/api/user/auth/device-key', { method: 'DELETE', headers: bearer(deviceKey) });
    return { revoked: true };
  } catch {
    return { revoked: false };
  }
}

//#region session handling

/** Trim an announced session down to the fields the host needs. */
function normalizeSession(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : '';
  if (apiKey === '') return null;
  const deviceKey = typeof raw.deviceKey === 'string' ? raw.deviceKey : '';
  const accessToken = typeof raw.accessToken === 'string' ? raw.accessToken : '';
  return {
    version: 1,
    baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl !== '' ? raw.baseUrl : EZCLOUD_BASE_URL,
    userId: typeof raw.userId === 'number' ? raw.userId : 0,
    username: typeof raw.username === 'string' ? raw.username : '',
    displayName: typeof raw.displayName === 'string' ? raw.displayName : '',
    group: typeof raw.group === 'string' ? raw.group : '',
    accessToken,
    deviceKey,
    apiKey,
    apiKeyId: typeof raw.apiKeyId === 'number' ? raw.apiKeyId : 0,
    apiKeyName: typeof raw.apiKeyName === 'string' ? raw.apiKeyName : API_KEY_NAME,
    signedInAt: typeof raw.signedInAt === 'number' ? raw.signedInAt : Date.now(),
  };
}

/**
 * The session a request belongs to: the one it carries, else the one announced
 * earlier in this process. Requests carry it so a first paint after a restart
 * works even before the page's sync call lands.
 */
function sessionOf(payload) {
  const carried = normalizeSession(payload === null || typeof payload !== 'object' ? undefined : payload.session);
  if (carried !== null) return carried;
  return liveSession;
}

function adoptSession(session) {
  liveSession = session;
  modelCache = { key: '', at: 0, entries: [] };
  if (session !== null) persistSessionFile(session);
}

function clearSession() {
  liveSession = null;
  modelCache = { key: '', at: 0, entries: [] };
  forgetSessionFile();
}

/** Authenticated dashboard request. The device key outlives the access token. */
async function authedJson(path, session, fallback, init) {
  const token = session.deviceKey !== '' ? session.deviceKey : session.accessToken;
  if (token === '') throw new Error('登录状态已失效，请重新登录 EZCloud');
  const options = init === undefined ? {} : init;
  const body = await ezcloudRequest(path, {
    ...options,
    headers: { ...bearer(token), ...(options.headers === undefined ? {} : options.headers) },
  });
  return requireSuccess(body, fallback);
}

//#endregion

//#region account reads

async function fetchStatus() {
  const now = Date.now();
  if (statusCache.at !== 0 && now - statusCache.at < STATUS_CACHE_MS) return statusCache;
  const body = await ezcloudRequest('/api/status');
  const data = body !== null && typeof body === 'object' && body.data !== null && typeof body.data === 'object' ? body.data : {};
  const creditsPerUsd = Number(data.credits_per_usd);
  const quotaPerUnit = Number(data.quota_per_unit);
  statusCache = {
    at: now,
    creditsPerUsd: Number.isFinite(creditsPerUsd) && creditsPerUsd > 0 ? creditsPerUsd : 500,
    quotaPerUnit: Number.isFinite(quotaPerUnit) && quotaPerUnit > 0 ? quotaPerUnit : 500000,
  };
  return statusCache;
}

async function fetchPricing() {
  const now = Date.now();
  if (pricingCache.at !== 0 && now - pricingCache.at < PRICING_CACHE_MS) return pricingCache;
  const body = requireSuccess(await ezcloudRequest('/api/pricing'), '无法读取 EZCloud 模型目录');
  const rows = Array.isArray(body.data) ? body.data : [];
  const vendors = new Map();
  if (Array.isArray(body.vendors)) {
    for (const vendor of body.vendors) {
      if (vendor !== null && typeof vendor === 'object' && Number.isInteger(vendor.id)) {
        vendors.set(vendor.id, {
          id: vendor.id,
          name: typeof vendor.name === 'string' ? vendor.name : '',
          icon: typeof vendor.icon === 'string' ? vendor.icon : '',
        });
      }
    }
  }
  pricingCache = { at: now, rows, vendors };
  return pricingCache;
}

/**
 * Model ids the signed-in account's groups may call over the OpenAI-compatible
 * API. The deployment route is `/api/user/models`; older builds exposed the same
 * handler below `/self`, so both are tried before falling back to pricing rows.
 */
async function fetchUsableModels(session) {
  for (const path of ['/api/user/models', '/api/user/self/models']) {
    try {
      const body = await authedJson(path, session, '无法读取账号可用模型');
      const data = body.data;
      if (!Array.isArray(data)) return null;
      return data.filter((name) => typeof name === 'string' && name !== '');
    } catch {
      // try the next spelling; the caller falls back to the pricing catalog
    }
  }
  return null;
}

const CONTEXT_HINTS = [
  [/claude/i, 200000],
  [/gemini/i, 1048576],
  [/deepseek/i, 131072],
  [/kimi|moonshot/i, 262144],
  [/qwen/i, 131072],
  [/llama/i, 131072],
  [/gpt-oss/i, 131072],
  [/gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|gpt-6|^o[1-9]/i, 128000],
];

/** Context window advertised in prose ("1.05M 上下文", "128K context"), 0 when absent. */
function contextFromProse(text) {
  if (typeof text !== 'string' || text === '') return 0;
  const match = /(\d+(?:\.\d+)?)\s*([KM])\s*(?:上下文|context)/i.exec(text);
  if (match === null) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = match[2].toUpperCase() === 'M' ? 1000000 : 1000;
  return Math.round(value * unit);
}

/** Output cap advertised in prose ("128K 输出", "8K output"), 0 when absent. */
function outputFromProse(text) {
  if (typeof text !== 'string' || text === '') return 0;
  const match = /(\d+(?:\.\d+)?)\s*([KM])\s*(?:输出|output)/i.exec(text);
  if (match === null) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = match[2].toUpperCase() === 'M' ? 1000000 : 1000;
  return Math.round(value * unit);
}

function contextWindowFor(model, description) {
  const prose = contextFromProse(description?.zh) || contextFromProse(description?.en);
  if (prose > 0) return prose;
  for (const [pattern, size] of CONTEXT_HINTS) if (pattern.test(model)) return size;
  return DEFAULT_CONTEXT_WINDOW;
}

/** Per-model output cap, clamped to the advertised context window. */
function maxTokensFor(contextWindow, description) {
  const prose = outputFromProse(description?.zh) || outputFromProse(description?.en);
  if (prose > 0) return Math.min(prose, contextWindow);
  return Math.min(DEFAULT_MAX_TOKENS, contextWindow);
}

/** `description` arrives as a JSON string holding `{zh, en}` (or plain prose). */
function parseDescription(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { zh: '', en: '' };
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      return {
        zh: typeof parsed.zh === 'string' ? parsed.zh : '',
        en: typeof parsed.en === 'string' ? parsed.en : '',
      };
    }
  } catch {
    /* plain prose descriptions pass through unchanged */
  }
  return { zh: raw, en: raw };
}

function summarize(description) {
  const text = description.zh !== '' ? description.zh : description.en;
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= 160 ? flat : `${flat.slice(0, 157)}…`;
}

/**
 * The backend's `credits` / `avg_credits` columns are uniform placeholders;
 * the real prices live in the tiered billing expression, whose coefficients
 * are USD per 1M tokens. E credits are that price times `credits_per_usd`,
 * averaged over a 75/25 input/output mix the same way the backend does.
 */
function parseTieredCoefficients(expr) {
  if (typeof expr !== 'string') return null;
  const start = expr.indexOf('tier(');
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  for (let index = start; index < expr.length; index += 1) {
    if (expr[index] === '(') depth += 1;
    else if (expr[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end === -1) return null;
  const head = expr.slice(start + 5, end);
  const comma = head.indexOf(',');
  const body = comma === -1 ? head : head.slice(comma + 1);
  const coefficients = new Map();
  const pattern = /\b(p|c|cr|cc|cc1h)\s*\*\s*([\d.]+)|\b([\d.]+)\s*\*\s*(p|c|cr|cc|cc1h)\b/g;
  for (const match of body.matchAll(pattern)) {
    const name = match[1] ?? match[4];
    const value = Number(match[2] ?? match[3]);
    if (Number.isFinite(value) && !coefficients.has(name)) coefficients.set(name, value);
  }
  return coefficients;
}

/** E prices for one pricing row; every field is null when the row carries none. */
function creditsForPricingRow(row, creditsPerUsd) {
  const empty = { avgCredits: null, inputE: null, outputE: null, cacheReadE: null, cacheWriteE: null };
  if (Number(row.quota_type) === 1) {
    const perCall = Number(row.credits);
    return { ...empty, avgCredits: Number.isFinite(perCall) && perCall > 0 ? perCall : null };
  }
  if (row.billing_mode !== 'tiered_expr') return empty;
  const coefficients = parseTieredCoefficients(row.billing_expr);
  const input = coefficients?.get('p');
  if (coefficients === null || !(Number(input) > 0)) return empty;
  const toE = (value) => Math.round(value * creditsPerUsd * 100) / 100;
  const output = coefficients.get('c');
  // One cache-write line: the 5-minute tier, falling back to the 1h tier.
  const cacheWrite = coefficients.get('cc') ?? coefficients.get('cc1h');
  return {
    avgCredits: Math.max(1, Math.round(creditsPerUsd * (0.75 * input + 0.25 * (output ?? input)))),
    inputE: toE(input),
    outputE: output === undefined ? null : toE(output),
    cacheReadE: coefficients.has('cr') ? toE(coefficients.get('cr')) : null,
    cacheWriteE: cacheWrite === undefined ? null : toE(cacheWrite),
  };
}

/**
 * The account's model catalog, joined with public pricing metadata.
 * Falls back to the pricing rows for the account's group when the per-account
 * endpoint cannot answer, so a signed-in account always sees its models.
 */
async function modelCatalog(session) {
  if (session === null) return [];
  if (modelCache.key === session.apiKey && Date.now() - modelCache.at < MODEL_CACHE_MS) {
    return modelCache.entries;
  }

  const [pricing, usable, status] = await Promise.all([
    fetchPricing(),
    fetchUsableModels(session).catch(() => null),
    fetchStatus().catch(() => null),
  ]);
  const creditsPerUsd = status === null ? 500 : status.creditsPerUsd;

  const entries = [];
  for (const row of pricing.rows) {
    if (row === null || typeof row !== 'object') continue;
    const id = typeof row.model_name === 'string' ? row.model_name : '';
    if (id === '') continue;
    if (Array.isArray(row.supported_endpoint_types) && !row.supported_endpoint_types.includes('openai')) continue;
    if (Array.isArray(row.output_modalities) && !row.output_modalities.includes('text')) continue;
    if (usable === null) {
      if (session.group !== '' && Array.isArray(row.enable_groups) && !row.enable_groups.includes(session.group)) continue;
    } else if (!usable.includes(id)) {
      continue;
    }

    const description = parseDescription(row.description);
    const vendor = pricing.vendors.get(row.vendor_id);
    const contextWindow = contextWindowFor(id, description);
    entries.push({
      id,
      name: id,
      vendor: vendor === undefined ? '' : vendor.name,
      description,
      summary: summarize(description),
      input: Array.isArray(row.input_modalities) && row.input_modalities.includes('image') ? ['text', 'image'] : ['text'],
      contextWindow,
      maxTokens: maxTokensFor(contextWindow, description),
      quotaType: Number(row.quota_type) === 1 ? 1 : 0,
      credits: Number(row.credits) > 0 ? Number(row.credits) : 0,
      completionRatio: Number(row.completion_ratio) > 0 ? Number(row.completion_ratio) : 0,
      billingMode: typeof row.billing_mode === 'string' ? row.billing_mode : '',
      ...creditsForPricingRow(row, creditsPerUsd),
      creditsPerUsd,
    });
  }

  entries.sort((left, right) => left.id.localeCompare(right.id));
  modelCache = { key: session.apiKey, at: Date.now(), entries };
  return entries;
}

const PREFERENCES = ['subscription_first', 'wallet_first', 'subscription_only', 'wallet_only'];

function normalizePreference(value) {
  return typeof value === 'string' && PREFERENCES.includes(value) ? value : 'subscription_first';
}

function toCredits(value, rate) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * rate * 10000) / 10000;
}

function normalizeWindow(view, rate) {
  if (view === null || typeof view !== 'object') return null;
  const used = toCredits(view.used, rate);
  const limit = toCredits(view.limit, rate);
  const remaining = toCredits(view.remaining, rate);
  return {
    used,
    limit,
    remaining,
    percent: limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0,
    startAt: Number.isFinite(Number(view.period_start)) ? Number(view.period_start) : 0,
    resetAt: Number.isFinite(Number(view.period_end)) ? Number(view.period_end) : 0,
  };
}

function normalizePlan(planBody, rate) {
  const data = planBody !== null && typeof planBody === 'object' && planBody.data !== null && typeof planBody.data === 'object' ? planBody.data : {};
  const preference = normalizePreference(data.billing_preference);
  if (data.has_active_plan !== true || data.plan === null || typeof data.plan !== 'object') {
    return { active: false, plan: null, usage: null, billingPreference: preference };
  }

  const plan = data.plan;
  const usage = data.usage !== null && typeof data.usage === 'object' ? data.usage : {};
  return {
    active: true,
    plan: {
      id: Number.isInteger(plan.id) ? plan.id : 0,
      title: typeof plan.title === 'string' ? plan.title : '',
      subtitle: typeof plan.subtitle === 'string' ? plan.subtitle : '',
      level: typeof plan.level === 'string' ? plan.level : '',
      currency: typeof plan.currency === 'string' ? plan.currency : '',
      price: toCredits(plan.price_amount, 1),
      credits: toCredits(plan.credits, 1),
      endTime: Number.isFinite(Number(plan.end_time)) ? Number(plan.end_time) : 0,
      total: toCredits(plan.total_amount, rate),
      used: toCredits(plan.amount_used, rate),
      remaining: toCredits(plan.amount_remaining, rate),
    },
    usage: {
      fiveHour: normalizeWindow(usage.five_hour ?? plan.five_hour_usage, rate),
      weekly: normalizeWindow(usage.weekly ?? plan.weekly_usage, rate),
      monthly: normalizeWindow(usage.monthly ?? plan.monthly_usage, rate),
    },
    billingPreference: preference,
  };
}

async function accountSnapshot(session) {
  const [selfBody, planBody, status] = await Promise.all([
    authedJson('/api/user/self', session, '无法读取 EZCloud 账号信息'),
    authedJson('/api/user/agent/plan', session, '无法读取订阅信息').catch(() => null),
    fetchStatus().catch(() => null),
  ]);

  const creditsPerUsd = status === null ? 500 : status.creditsPerUsd;
  const quotaPerUnit = status === null ? 500000 : status.quotaPerUnit;
  const rate = creditsPerUsd / quotaPerUnit;
  const self = selfBody.data !== null && typeof selfBody.data === 'object' ? selfBody.data : {};
  const planState = normalizePlan(planBody, rate);

  return {
    account: {
      username: typeof self.username === 'string' ? self.username : session.username,
      displayName: typeof self.display_name === 'string' ? self.display_name : session.displayName,
      group: typeof self.group === 'string' ? self.group : session.group,
      email: typeof self.email === 'string' ? self.email : '',
      isEnterprise: self.is_enterprise === true,
      signedInAt: session.signedInAt,
    },
    wallet: {
      credits: toCredits(self.quota_credits ?? self.quota, 1),
      usedCredits: toCredits(self.used_quota_credits ?? self.used_quota, 1),
      requestCount: Number.isFinite(Number(self.request_count)) ? Number(self.request_count) : 0,
      affiliateCredits: toCredits(self.aff_quota, 1),
      affiliateCount: Number.isFinite(Number(self.aff_count)) ? Number(self.aff_count) : 0,
    },
    subscription: planState,
    creditsPerUsd,
    baseUrl: session.baseUrl,
    fetchedAt: Date.now(),
  };
}

//#endregion

//#region LLM provider

function missingSessionError() {
  return new LlmError('尚未登录 EZCloud，请先在侧边栏登录', 'AUTH');
}

function flattenText(message) {
  return message.content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function providerError(status, text) {
  let detail = text.trim();
  try {
    const parsed = JSON.parse(text);
    const error = parsed !== null && typeof parsed === 'object' ? parsed.error : undefined;
    if (error !== null && typeof error === 'object' && typeof error.message === 'string') detail = error.message;
    else if (parsed !== null && typeof parsed === 'object' && typeof parsed.message === 'string') detail = parsed.message;
  } catch {
    /* non-JSON gateway error */
  }
  if (detail === '') detail = `EZCloud 返回 HTTP ${status}`;

  let code = 'TRANSPORT';
  if (status === 401 || status === 403) code = 'AUTH';
  else if (status === 402) code = 'QUOTA';
  else if (status === 429) code = 'RATE_LIMIT';
  else if (status === 400) code = /context[ _-]?(length|window)/i.test(detail) ? 'CONTEXT_WINDOW_EXCEEDED' : 'INVALID_REQUEST';
  return new LlmError(detail, code, { cause: new Error(text) });
}

/** Streaming SSE writer: one DSH block per reasoning/text run and per tool call. */
class StreamWriter {
  constructor() {
    this.blocks = [];
    this.text = null;
    this.reasoning = null;
    this.tools = new Map();
    this.usage = null;
    this.finishReason = null;
  }

  begin(kind, slot) {
    const block = {
      index: this.blocks.length,
      kind,
      slot: slot === undefined ? -1 : slot,
      text: '',
      id: '',
      name: '',
      arguments: '',
    };
    this.blocks.push(block);
    return block;
  }

  *delta(delta) {
    const reasoning =
      typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string'
          ? delta.reasoning
          : '';
    if (reasoning !== '') {
      if (this.reasoning === null) {
        this.reasoning = this.begin('reasoning');
        yield { type: 'block-start', index: this.reasoning.index, blockType: 'reasoning' };
      }
      this.reasoning.text += reasoning;
      yield { type: 'reasoning-delta', index: this.reasoning.index, text: reasoning };
    }

    const text = typeof delta.content === 'string' ? delta.content : '';
    if (text !== '') {
      if (this.text === null) {
        this.text = this.begin('text');
        yield { type: 'block-start', index: this.text.index, blockType: 'text' };
      }
      this.text.text += text;
      yield { type: 'text-delta', index: this.text.index, text };
    }

    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const call of calls) {
      if (call === null || typeof call !== 'object') continue;
      const slot = Number.isInteger(call.index) ? call.index : 0;
      let block = this.tools.get(slot);
      if (block === undefined) {
        block = this.begin('tool-call', slot);
        this.tools.set(slot, block);
        yield { type: 'block-start', index: block.index, blockType: 'tool-call' };
      }
      if (typeof call.id === 'string' && call.id !== '' && block.id === '') block.id = call.id;
      const name = call.function !== null && typeof call.function === 'object' ? call.function.name : undefined;
      if (typeof name === 'string' && name !== '' && block.name === '') block.name = name;
      const piece =
        call.function !== null && typeof call.function === 'object' && typeof call.function.arguments === 'string'
          ? call.function.arguments
          : '';
      block.arguments += piece;
      yield {
        type: 'tool-call-delta',
        index: block.index,
        id: block.id,
        ...(block.name === '' ? {} : { name: block.name }),
        argumentsDelta: piece,
      };
    }
  }

  *endBlocks() {
    for (const block of this.blocks) {
      if (block.kind === 'text') {
        yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } };
      } else if (block.kind === 'reasoning') {
        yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } };
      } else {
        yield {
          type: 'block-end',
          index: block.index,
          block: { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments === '' ? '{}' : block.arguments },
        };
      }
    }
  }

  *finish() {
    if (this.blocks.length === 0) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'EZCloud 返回了空响应', code: 'EMPTY_RESPONSE' },
        },
      };
      return;
    }
    if (this.usage !== null) yield { type: 'usage', usage: this.usage };
    let reason;
    if (this.finishReason === 'length') reason = { kind: 'max-tokens' };
    else if (this.finishReason === 'tool_calls' || this.tools.size > 0) reason = { kind: 'tool-calls' };
    else reason = { kind: 'stop' };
    yield { type: 'finish', reason };
  }
}

function parseSseEvent(raw) {
  const lines = raw.split('\n');
  const parts = [];
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    parts.push(line.slice(5).trimStart());
  }
  if (parts.length === 0) return null;
  const payload = parts.join('\n').trim();
  return payload === '' ? null : payload;
}

class EzCloudAdapter extends LlmAdapter {
  constructor(ctx) {
    super();
    this.ctx = ctx;
  }

  providerInfo(provider) {
    return { id: provider, name: PROVIDER_NAME };
  }

  async listModels(provider) {
    const session = liveSession;
    if (session === null) {
      trace('listModels: no session, returning 0 models');
      return [];
    }
    try {
      const entries = await modelCatalog(session);
      trace(`listModels: ${entries.length} models (group=${session.group === '' ? '-' : session.group})`);
      return entries.map((entry) => ({
        provider,
        id: entry.id,
        name: entry.name,
        ...(entry.summary === '' ? {} : { description: entry.summary }),
        inputModalities: entry.input,
      }));
    } catch (error) {
      // A catalog read failure must not break the model picker; the account
      // dialog surfaces the same error with actionable wording.
      trace(`listModels failed: ${messageOf(error)}`);
      return [];
    }
  }

  async resolveModel(provider, model) {
    const session = liveSession;
    let entry;
    if (session !== null) {
      try {
        entry = (await modelCatalog(session)).find((item) => item.id === model);
      } catch {
        entry = undefined;
      }
    }
    return {
      provider,
      id: model,
      name: entry === undefined ? model : entry.name,
      ...(entry === undefined || entry.summary === '' ? {} : { description: entry.summary }),
      ...(entry === undefined ? {} : { inputModalities: entry.input }),
      context: { contextWindow: entry === undefined ? DEFAULT_CONTEXT_WINDOW : entry.contextWindow },
      defaultMaxTokens: entry === undefined ? DEFAULT_MAX_TOKENS : entry.maxTokens,
      reasoning: {
        efforts: REASONING_EFFORTS.map((effort) => ({ ...effort })),
        defaultEffort: DEFAULT_REASONING_EFFORT,
      },
    };
  }

  async *stream(options) {
    const session = liveSession;
    if (session === null) throw missingSessionError();
    const signal = options.signal;
    if (signal !== undefined) signal.throwIfAborted();

    const body = await this.buildRequest(options, signal);
    let response;
    try {
      response = await fetch(`${EZCLOUD_BASE_URL}${CHAT_PATH}`, {
        method: 'POST',
        headers: {
          ...attributionHeaders(),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${session.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal !== undefined && signal.aborted) throw new LlmError('EZCloud 请求已取消', 'ABORTED', { cause: error });
      throw new LlmError(
        `无法连接 EZCloud：${error instanceof Error ? error.message : String(error)}`,
        'TRANSPORT',
        { cause: error },
      );
    }

    if (!response.ok) throw providerError(response.status, await response.text());
    if (response.body === null) throw new LlmError('EZCloud 返回了空响应', 'EMPTY_RESPONSE');

    const writer = new StreamWriter();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const payload = parseSseEvent(event);
          if (payload === null) continue;
          if (payload === '[DONE]') {
            finished = true;
            break;
          }
          let parsed;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          if (parsed === null || typeof parsed !== 'object') continue;
          if (parsed.error !== null && typeof parsed.error === 'object') {
            const message = typeof parsed.error.message === 'string' ? parsed.error.message : 'EZCloud 流式响应失败';
            throw new LlmError(message, /quota|余额|额度/i.test(message) ? 'QUOTA' : 'TRANSPORT');
          }
          if (parsed.usage !== null && typeof parsed.usage === 'object') {
            const usage = parsed.usage;
            const cacheRead = usage.prompt_tokens_details !== null && typeof usage.prompt_tokens_details === 'object'
              ? Number(usage.prompt_tokens_details.cached_tokens)
              : 0;
            writer.usage = {
              inputTokens: Number(usage.prompt_tokens) || 0,
              outputTokens: Number(usage.completion_tokens) || 0,
              totalTokens: Number(usage.total_tokens) || 0,
              ...(Number.isFinite(cacheRead) && cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
            };
          }
          const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
          const choice = choices.find((item) => item !== null && typeof item === 'object');
          if (choice === undefined) continue;
          if (choice.delta !== null && typeof choice.delta === 'object') {
            for (const chunk of writer.delta(choice.delta)) yield chunk;
          }
          if (typeof choice.finish_reason === 'string' && choice.finish_reason !== '') {
            writer.finishReason = choice.finish_reason;
          }
        }
        if (finished) break;
      }
    } catch (error) {
      if (error instanceof LlmError) throw error;
      if (signal !== undefined && signal.aborted) throw new LlmError('EZCloud 请求已取消', 'ABORTED', { cause: error });
      throw new LlmError('EZCloud 流式响应中断', 'TRANSPORT', { cause: error });
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* the stream is already gone */
      }
    }

    for (const chunk of writer.endBlocks()) yield chunk;
    for (const chunk of writer.finish()) yield chunk;
  }

  async buildRequest(options, signal) {
    const system = [];
    if (typeof options.system === 'string' && options.system.trim() !== '') system.push(options.system);

    const messages = [];
    for (const message of options.messages) {
      if (message === null || typeof message !== 'object') continue;
      if (message.role === 'system' || message.role === 'developer') {
        const text = flattenText(message);
        if (text !== '') system.push(text);
        continue;
      }
      if (message.role === 'user') {
        messages.push({ role: 'user', content: await this.userContent(message.content, signal) });
        continue;
      }
      if (message.role === 'assistant') {
        const assistant = this.assistantMessage(message);
        if (assistant !== null) messages.push(assistant);
        continue;
      }
      if (message.role === 'tool') {
        // OpenAI tool messages carry text only; attachments are named instead of
        // being dropped silently.
        const dropped = message.content.some(
          (block) => block !== null && typeof block === 'object' && (block.type === 'image' || block.type === 'file'),
        );
        const text = flattenText(message);
        messages.push({
          role: 'tool',
          tool_call_id: typeof message.toolCallId === 'string' ? message.toolCallId : '',
          content: [text, dropped ? '[附件内容已省略]' : ''].filter((part) => part !== '').join('\n') || '(no output)',
        });
      }
    }
    if (system.length > 0) messages.unshift({ role: 'system', content: system.join('\n\n') });

    const body = {
      model: options.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (Number.isSafeInteger(options.maxTokens) && options.maxTokens > 0) body.max_tokens = options.maxTokens;
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop;
    // Anything outside the accepted set makes the gateway reroute to another
    // model silently, so an unknown value is dropped instead of forwarded.
    if (typeof options.reasoningEffort === 'string' && REASONING_EFFORT_IDS.has(options.reasoningEffort)) {
      body.reasoning_effort = options.reasoningEffort;
    }
    if (Array.isArray(options.tools) && options.tools.length > 0) {
      body.tools = options.tools
        .filter((tool) => tool !== null && typeof tool === 'object' && typeof tool.name === 'string' && tool.name !== '')
        .map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: typeof tool.description === 'string' ? tool.description : '',
            parameters: tool.parameters !== null && typeof tool.parameters === 'object' ? tool.parameters : { type: 'object', properties: {} },
          },
        }));
    }
    return body;
  }

  async userContent(blocks, signal) {
    const parts = [];
    for (const block of blocks) {
      if (block === null || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
        parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        const image = await this.imagePart(block, signal);
        parts.push(image === null ? { type: 'text', text: '[图片已省略]' } : image);
      }
    }
    if (parts.every((part) => part.type === 'text')) return parts.map((part) => part.text).join('');
    return parts;
  }

  async imagePart(block, signal) {
    const attachments = typeof this.ctx.get === 'function' ? this.ctx.get('attachments') : undefined;
    if (attachments === undefined || attachments === null || typeof attachments.readImageRequest !== 'function') return null;
    try {
      const version = await attachments.readImageRequest(
        block.attachment,
        { maxPixels: IMAGE_PIXEL_BUDGET, maxBytes: IMAGE_BYTE_BUDGET },
        signal,
      );
      const data = Buffer.from(version.data).toString('base64');
      return { type: 'image_url', image_url: { url: `data:${version.mediaType};base64,${data}` } };
    } catch {
      return null;
    }
  }

  assistantMessage(message) {
    const texts = [];
    const toolCalls = [];
    for (const block of message.content) {
      if (block === null || typeof block !== 'object') continue;
      if (block.type === 'text') texts.push(block.text);
      else if (block.type === 'tool-call') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? {}),
          },
        });
      }
    }
    if (texts.length === 0 && toolCalls.length === 0) return null;
    return {
      role: 'assistant',
      content: texts.join(''),
      ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
    };
  }
}

//#endregion

/**
 * Cross-origin guard. The connection service knows which origins may drive the
 * host; without it the routes stay reachable for same-origin page code only,
 * which the route table already limits to this server.
 */
function isForeignRequest(ctx, request) {
  const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
  if (connection === undefined || connection === null) return false;
  if (typeof connection.requestRejection !== 'function') return false;
  return connection.requestRejection(request) !== undefined;
}

export const name = 'ezagent-host';

/**
 * Only `webServer` is a hard dependency. The LLM registry is optional on
 * purpose: a profile plugin does not always see the host's `llm` service while
 * its fiber starts, and waiting for it would leave `apply` unexecuted — which
 * also drops the HTTP routes below. The service is picked up lazily instead, so
 * the account panel works even when model registration is unavailable.
 */
export const inject = ['webServer'];

/** Outcome of the optional provider registration, surfaced through `/diagnostics`. */
const adapterState = { registered: false, error: '' };

function messageOf(error) {
  return error instanceof Error && error.message !== '' ? error.message : String(error);
}

// A restart keeps the provider usable before the page re-announces its session.
liveSession = readSessionFile();
trace(`startup: session=${liveSession === null ? 'none' : 'restored'}`);

export function apply(ctx) {
  const llmOf = () => {
    try {
      const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined;
      return llm === null || llm === undefined || typeof llm.registerAdapter !== 'function' ? undefined : llm;
    } catch {
      return undefined;
    }
  };

  const registerProvider = () => {
    // `ctx.inject` and the retry timer can both fire; a second registration
    // would be refused as DUPLICATE_ADAPTER and would overwrite a healthy state.
    if (adapterState.registered && adapterState.error === '') return true;
    const llm = llmOf();
    if (llm === undefined) {
      adapterState.registered = false;
      adapterState.error = '宿主端尚未提供 llm 服务';
      return false;
    }
    try {
      // `registerAdapter(providers, adapter)`: providers are the route ids the
      // adapter serves, and `providerInfo(id)` must echo the same id back.
      llm.registerAdapter([PROVIDER_ID], new EzCloudAdapter(ctx));
      adapterState.registered = true;
      adapterState.error = '';
      trace('adapter registered');
      return true;
    } catch (error) {
      if (messageOf(error).includes('already registered')) {
        // Another fiber holds the route; ours is not the owner but the provider
        // is live, which is what the picker cares about.
        adapterState.registered = true;
        adapterState.error = '';
        trace('adapter already registered by another fiber');
        return true;
      }
      adapterState.registered = false;
      adapterState.error = messageOf(error);
      trace(`adapter registration failed: ${adapterState.error}`);
      return false;
    }
  };

  if (!registerProvider()) {
    // The registry usually appears after the profile plugin's own fiber starts;
    // retry once it is announced, and give up quietly when it never arrives.
    try {
      ctx.inject(['llm'], () => {
        registerProvider();
      });
    } catch {
      /* keep the HTTP routes usable even without model registration */
    }

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (registerProvider() || attempts >= 30) clearInterval(timer);
    }, 1000);
    if (typeof timer.unref === 'function') timer.unref();
    ctx.effect(() => () => clearInterval(timer));
  }

  const announce = () => {
    const llm = llmOf();
    if (llm === undefined || typeof llm.emitAdaptersUpdated !== 'function') return;
    try {
      llm.emitAdaptersUpdated();
    } catch {
      /* observers are best-effort */
    }
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (request, response) => {
          if (isForeignRequest(ctx, request)) {
            sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
            return;
          }
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: { code: 'method-error', message: 'POST only' } });
            return;
          }

          const pathname = new URL(request.url ?? '/', 'http://dsh.internal').pathname;
          try {
            const payload = await readJsonBody(request);

            if (pathname === `${ROUTE_PREFIX}/sign-in`) {
              const session = await signIn(payload);
              adoptSession(normalizeSession(session));
              announce();
              sendJson(response, 200, { ok: true, session });
              return;
            }

            if (pathname === `${ROUTE_PREFIX}/sign-out`) {
              const result = await signOut(payload);
              clearSession();
              announce();
              sendJson(response, 200, { ok: true, result });
              return;
            }

            // The page announces its stored session on every load so the host
            // (which keeps it in memory only) can serve model requests again
            // after an app restart.
            if (pathname === `${ROUTE_PREFIX}/sync`) {
              const session = normalizeSession(payload.session);
              if (session === null) {
                clearSession();
                trace('sync: cleared session');
                sendJson(response, 200, { ok: true, signedIn: false });
              } else {
                adoptSession(session);
                trace(`sync: adopted session (group=${session.group === '' ? '-' : session.group}, deviceKey=${session.deviceKey === '' ? 'no' : 'yes'})`);
                announce();
                sendJson(response, 200, { ok: true, signedIn: true });
              }
              return;
            }

            if (pathname === `${ROUTE_PREFIX}/account`) {
              const session = sessionOf(payload);
              if (session === null) throw new Error('尚未登录 EZCloud');
              sendJson(response, 200, { ok: true, snapshot: await accountSnapshot(session) });
              return;
            }

            if (pathname === `${ROUTE_PREFIX}/models`) {
              const session = sessionOf(payload);
              if (session === null) throw new Error('尚未登录 EZCloud');
              if (payload.refresh === true) {
                modelCache = { key: '', at: 0, entries: [] };
                pricingCache = { at: 0, rows: [], vendors: new Map() };
              }
              const entries = await modelCatalog(session);
              sendJson(response, 200, {
                ok: true,
                models: entries.map((entry) => ({
                  id: entry.id,
                  name: entry.name,
                  vendor: entry.vendor,
                  description: entry.description,
                  input: entry.input,
                  contextWindow: entry.contextWindow,
                  quotaType: entry.quotaType,
                  credits: entry.credits,
                  avgCredits: entry.avgCredits,
                  inputE: entry.inputE,
                  outputE: entry.outputE,
                  cacheReadE: entry.cacheReadE,
                  cacheWriteE: entry.cacheWriteE,
                  creditsPerUsd: entry.creditsPerUsd,
                  completionRatio: entry.completionRatio,
                  billingMode: entry.billingMode,
                  maxTokens: entry.maxTokens,
                })),
                fetchedAt: Date.now(),
              });
              return;
            }

            if (pathname === `${ROUTE_PREFIX}/billing-preference`) {
              const session = sessionOf(payload);
              if (session === null) throw new Error('尚未登录 EZCloud');
              const preference = normalizePreference(payload.preference);
              await authedJson('/api/subscription/self/preference', session, '无法保存计费方式', {
                method: 'PUT',
                headers: { ...bearer(session.deviceKey || session.accessToken), 'Content-Type': 'application/json' },
                body: JSON.stringify({ billing_preference: preference }),
              });
              sendJson(response, 200, { ok: true, preference });
              return;
            }

            // Health probe: lets the account panel explain a missing model
            // group instead of silently showing an empty picker.
            if (pathname === `${ROUTE_PREFIX}/diagnostics`) {
              let registeredProviders = [];
              try {
                const llm = llmOf();
                if (llm !== undefined && typeof llm.listProviders === 'function') {
                  registeredProviders = llm.listProviders().map((provider) => provider.id);
                }
              } catch {
                /* the registry is a best-effort probe */
              }
              sendJson(response, 200, {
                ok: true,
                plugin: PLUGIN_VERSION,
                provider: PROVIDER_ID,
                registered: adapterState.registered,
                registeredProviders,
                adapterError: adapterState.error,
                llmAvailable: llmOf() !== undefined,
                signedIn: liveSession !== null,
              });
              return;
            }

            sendJson(response, 404, { ok: false, error: { code: 'not-found', message: 'unknown route' } });
          } catch (error) {
            const message = error instanceof Error && error.message !== '' ? error.message : 'EZCloud 请求失败';
            sendJson(response, 200, { ok: false, error: { code: 'ezcloud', message } });
          }
        },
      }),
    'EZAgent: /ezagent/ezcloud routes',
  );
}

export const testing = { signIn, signOut, ROUTE_PREFIX, PROVIDER_ID, normalizeSession, normalizePlan };
