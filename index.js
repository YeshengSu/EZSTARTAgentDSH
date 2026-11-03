/**
 * EZAgent host half.
 *
 * The EZCloud gateway answers its real responses without CORS headers (only
 * preflight `OPTIONS` carries them), so a browser cannot call it directly from
 * the DSH page. This half performs the sign-in over Node's network stack and
 * exposes it to the client at `/ezagent/ezcloud/*`, which the page reaches
 * same-origin (the desktop shell forwards `dsh-app://app/…` to this server).
 */

const EZCLOUD_BASE_URL = 'https://api.ezstartai.com';
const API_KEY_NAME = 'EZAgent';
const ROUTE_PREFIX = '/ezagent/ezcloud';
const REQUEST_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 64 * 1024;

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
export const inject = ['webServer'];

export function apply(ctx) {
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
              sendJson(response, 200, { ok: true, session: await signIn(payload) });
              return;
            }
            if (pathname === `${ROUTE_PREFIX}/sign-out`) {
              sendJson(response, 200, { ok: true, result: await signOut(payload) });
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

export const testing = { signIn, signOut, ROUTE_PREFIX };
