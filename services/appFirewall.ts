/**
 * 应用层轻量防火墙：登录防爆破、客户端请求节流、可疑输入拦截。
 * 与 API 侧 api/_firewall.ts 配合，不改变业务接口语义。
 */

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const CLIENT_API_WINDOW_MS = 60 * 1000;
const CLIENT_API_MAX = 90;

type AttemptBucket = { count: number; resetAt: number };

const loginBuckets = new Map<string, AttemptBucket>();
const apiBuckets = new Map<string, AttemptBucket>();

const bump = (
  map: Map<string, AttemptBucket>,
  key: string,
  windowMs: number,
  max: number
): { ok: boolean; retryAfterSec: number; remaining: number } => {
  const now = Date.now();
  const cur = map.get(key);
  if (!cur || now >= cur.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0, remaining: max - 1 };
  }
  if (cur.count >= max) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)),
      remaining: 0,
    };
  }
  cur.count += 1;
  map.set(key, cur);
  return { ok: true, retryAfterSec: 0, remaining: max - cur.count };
};

const clientFinger = (): string => {
  try {
    return [
      navigator.userAgent?.slice(0, 80) || '',
      navigator.language || '',
      String(screen.width),
      String(screen.height),
    ].join('|');
  } catch {
    return 'unknown';
  }
};

/** 登录前：是否被临时锁定 */
export const checkLoginAllowed = (
  username: string
): { ok: boolean; message?: string } => {
  const key = `login:${(username || '').trim().toLowerCase()}|${clientFinger()}`;
  const now = Date.now();
  const cur = loginBuckets.get(key);
  if (cur && now < cur.resetAt && cur.count >= LOGIN_MAX_FAILURES) {
    const sec = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
    return {
      ok: false,
      message: `登录失败次数过多，请 ${sec} 秒后再试（防暴力破解）。`,
    };
  }
  return { ok: true };
};

export const recordLoginFailure = (username: string) => {
  const key = `login:${(username || '').trim().toLowerCase()}|${clientFinger()}`;
  bump(loginBuckets, key, LOGIN_WINDOW_MS, LOGIN_MAX_FAILURES);
};

export const clearLoginFailures = (username: string) => {
  const key = `login:${(username || '').trim().toLowerCase()}|${clientFinger()}`;
  loginBuckets.delete(key);
};

/** 用户名安全校验（防注入/超长） */
export const sanitizeUsernameInput = (raw: string): { ok: boolean; value: string; message?: string } => {
  const value = (raw || '').trim();
  if (!value) return { ok: false, value: '', message: '请输入用户名' };
  if (value.length > 64) return { ok: false, value: '', message: '用户名过长' };
  if (/[<>'"\\;\x00-\x1f]/.test(value)) {
    return { ok: false, value: '', message: '用户名包含非法字符' };
  }
  return { ok: true, value };
};

/** 前端发起敏感 API 前的节流（同浏览器） */
export const assertClientApiBudget = (bucket = 'default'): { ok: boolean; message?: string } => {
  const key = `${bucket}|${clientFinger()}`;
  const r = bump(apiBuckets, key, CLIENT_API_WINDOW_MS, CLIENT_API_MAX);
  if (!r.ok) {
    return {
      ok: false,
      message: `请求过于频繁，请 ${r.retryAfterSec} 秒后再试（防火墙限流）。`,
    };
  }
  return { ok: true };
};

/** 检测明显攻击型路径/载荷片段 */
export const looksLikeAttackPayload = (text: string): boolean => {
  const s = (text || '').toLowerCase();
  if (!s) return false;
  if (s.length > 200_000) return true;
  return (
    /(<script|javascript:|onerror\s*=|union\s+select|drop\s+table|\.\.\/\.\.\/|%00)/i.test(s) ||
    /(\beval\s*\(|function\s*\(\s*\)\s*\{)/i.test(s.slice(0, 2000))
  );
};
