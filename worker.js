/**
 * Cloudflare Worker / Supabase 同源反向代理
 * ------------------------------------------------------------------
 * 作用：
 *   浏览器 ->  https://123-cz7.pages.dev/api/supabase/rest/v1/wrong_questions
 *   Worker  ->  https://ceaulbusyznudguxzivy.supabase.co/rest/v1/wrong_questions
 *
 * 这样浏览器不再直接解析/连接 *.supabase.co，避免国内网络
 * ERR_CONNECTION_RESET / ERR_NAME_NOT_RESOLVED。
 *
 * 重要：
 *   1. 这个文件不要放在 Vite 的 src/ 或 public/ 里，避免被前端打包。
 *   2. 需要同源 /api/supabase/* 路由：
 *      - 推荐：放到 Pages Functions（functions/api/supabase/[[path]].js）
 *      - 或者：独立 Worker + 你自己的自定义域名路由
 *      - 注意：Cloudflare 不允许给 123-cz7.pages.dev 这种 pages.dev 主机
 *        添加独立 Worker Route，因为 pages.dev 不是你账号下的 Zone。
 *   3. Worker 只转发请求，不注入 service_role，不绕过 Supabase RLS。
 *   4. Realtime 是 WebSocket，本代理不支持；本项目是刷新同步，不需要。
 */

const SUPABASE_ORIGIN = 'https://ceaulbusyznudguxzivy.supabase.co';
const API_PREFIX = '/api/supabase';
const TIMEOUT_MS = 25000;

/**
 * 允许的浏览器来源。
 * 如果你绑定自定义域名，把自定义域名加到这里。
 * pages.dev 的预览域名形如 xxx.123-cz7.pages.dev，用后缀规则放行。
 */
const ALLOWED_ORIGINS = new Set([
  'https://123-cz7.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173'
]);
const PAGES_PREVIEW_SUFFIX = '.123-cz7.pages.dev';

function isAllowedOrigin(origin) {
  if (!origin) return true; // curl / 同源 GET 可能没有 Origin
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.endsWith(PAGES_PREVIEW_SUFFIX);
  } catch {
    return false;
  }
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowed = isAllowedOrigin(origin);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': [
      'authorization',
      'apikey',
      'content-type',
      'accept',
      'prefer',
      'range',
      'x-client-info',
      'x-supabase-api-version',
      'x-user-token',
      'content-profile',
      'accept-profile',
      'x-requested-with'
    ].join(', '),
    'Access-Control-Expose-Headers': [
      'content-range',
      'content-profile',
      'content-location',
      'x-supabase-api-version',
      'x-proxy-error'
    ].join(', '),
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };

  if (origin && allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else if (!origin) {
    // curl 或同源无 Origin；不涉及 cookie，可以用 *
    headers['Access-Control-Allow-Origin'] = '*';
  }
  // origin 不合法时不返回 ACAO，让浏览器自行拦截。
  return headers;
}

function jsonError(request, status, message, code, detail = '') {
  return new Response(JSON.stringify({
    error: message,
    message,
    code,
    ...(detail ? { detail } : {})
  }), {
    status,
    headers: {
      ...corsHeaders(request),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-proxy-error': code
    }
  });
}

/**
 * 把 /api/supabase/... 映射到真实 Supabase。
 *
 * 因为 @supabase/supabase-js 会自动在 baseUrl 后面拼 /rest/v1，
 * 所以实际收到的路径通常是：
 *   /api/supabase/rest/v1/wrong_questions
 *
 * 这里保留 /rest/v1、/auth/v1、/storage/v1、/functions/v1；
 * 其他路径（例如 /api/supabase/wrong_questions）默认补 /rest/v1。
 */
function buildTargetUrl(request) {
  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith(API_PREFIX)) return null;

  let suffix = incoming.pathname.slice(API_PREFIX.length);
  if (!suffix) suffix = '/';
  if (!suffix.startsWith('/')) suffix = `/${suffix}`;

  const directPrefixes = ['/rest/v1', '/auth/v1', '/storage/v1', '/functions/v1'];
  const isDirect = directPrefixes.some((prefix) => (
    suffix === prefix || suffix.startsWith(`${prefix}/`)
  ));
  const targetPath = isDirect ? suffix : `/rest/v1${suffix}`;
  const target = new URL(`${SUPABASE_ORIGIN}${targetPath}`);
  target.search = incoming.search;
  return target;
}

function cleanRequestHeaders(request) {
  const headers = new Headers(request.headers);

  // 这些是 hop-by-hop / Cloudflare 边缘头，转发会出问题。
  const remove = [
    'host',
    'content-length',
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
    'cf-visitor',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-real-ip'
  ];
  for (const name of remove) headers.delete(name);
  return headers;
}

async function proxy(request) {
  const target = buildTargetUrl(request);
  if (!target) {
    return jsonError(request, 404, '代理路由不存在，请使用 /api/supabase/*。', 'PROXY_ROUTE_NOT_FOUND');
  }

  // Realtime 是 WebSocket；这个代理是 HTTP 代理，不支持。
  if ((request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
    return jsonError(
      request,
      501,
      '当前代理不支持 WebSocket Realtime，请刷新页面获取最新数据。',
      'REALTIME_NOT_SUPPORTED'
    );
  }

  const method = request.method.toUpperCase();
  const headers = cleanRequestHeaders(request);
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    // 先读成 ArrayBuffer，避免流式 body 与 content-length 的边界问题。
    body = await request.arrayBuffer();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(target.toString(), {
      method,
      headers,
      body,
      redirect: 'follow',
      signal: controller.signal
    });

    const responseHeaders = new Headers(upstream.headers);

    // 删掉 Supabase 返回的 CORS 头，避免和 Worker 的头重复，
    // 浏览器看到两个 Access-Control-Allow-Origin 会直接报错。
    for (const key of [...responseHeaders.keys()]) {
      if (key.toLowerCase().startsWith('access-control-')) {
        responseHeaders.delete(key);
      }
    }
    for (const [key, value] of Object.entries(corsHeaders(request))) {
      responseHeaders.set(key, value);
    }
    responseHeaders.set('x-proxy-by', 'cloudflare-supabase-proxy');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    console.error('[supabase-proxy] upstream fetch failed', {
      url: target.toString(),
      message: error?.message
    });
    return jsonError(
      request,
      isTimeout ? 504 : 502,
      isTimeout
        ? '云端代理超时，请稍后重试。'
        : '云端代理暂时不可用，请稍后重试。',
      isTimeout ? 'PROXY_TIMEOUT' : 'PROXY_FETCH_FAILED',
      // 不把 apikey/token 打到响应里；只给简短错误。
      error?.message || ''
    );
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request) {
    // 浏览器 CORS 预检：不转发到 Supabase，直接本地响应。
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (origin && !isAllowedOrigin(origin)) {
        return jsonError(request, 403, '来源不在允许列表。', 'ORIGIN_NOT_ALLOWED');
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    return proxy(request);
  }
};
