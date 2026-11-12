import { createClient } from '@supabase/supabase-js';

const rawUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const rawAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const SUPABASE_URL = rawUrl;
export const SUPABASE_ANON_KEY = rawAnonKey;
export const AI_FUNCTION_URL = rawUrl ? `${rawUrl}/functions/v1/ai` : '';

function looksLikeServiceRoleKey(key) {
  if (!key) return false;
  if (String(key).startsWith('sb_secret_')) return true;
  const parts = String(key).split('.');
  if (parts.length !== 3) return false;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

export const configError = (() => {
  if (!rawUrl || !rawAnonKey) {
    return '缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。请在 .env 或 Cloudflare Pages 环境变量中配置。';
  }
  if (rawUrl.includes('YOUR_PROJECT') || rawAnonKey.includes('YOUR_SUPABASE')) {
    return 'Supabase 环境变量仍是示例占位值，请填写真实项目地址和 anon public key。';
  }
  if (looksLikeServiceRoleKey(rawAnonKey)) {
    return '检测到 service_role / secret key。前端只能使用 anon public key，请立即轮换密钥。';
  }
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'VITE_SUPABASE_URL 必须是 http(s) 地址。';
    }
  } catch {
    return 'VITE_SUPABASE_URL 不是合法 URL。';
  }
  return '';
})();

export const isSupabaseConfigured = !configError;

let currentUserToken = '';

export function setUserToken(token) {
  currentUserToken = String(token || '').trim();
}

export function getUserToken() {
  return currentUserToken;
}

// 所有 PostgREST / RPC / Storage 请求都带 x-user-token。
// RLS 通过 current_setting('request.headers') 读取它，做无账号 token 隔离。
const tokenFetch = (input, init = {}) => {
  const headers = new Headers(
    init.headers || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined)
  );
  if (currentUserToken) headers.set('x-user-token', currentUserToken);
  headers.set('x-application-name', 'econ-ai-bank');
  return fetch(input, { ...init, headers });
};

export const supabase = isSupabaseConfigured
  ? createClient(rawUrl, rawAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      global: {
        fetch: tokenFetch,
        headers: {
          'x-application-name': 'econ-ai-bank'
        }
      }
    })
  : null;

export function requireSupabase() {
  if (!supabase) throw new Error(configError || 'Supabase 未配置');
  return supabase;
}
