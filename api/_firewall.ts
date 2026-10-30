/**
 * API 侧轻量防火墙辅助（供 serverless handlers 引用）
 * 与 services/appFirewall.ts 对应。
 *
 * 说明：Vercel 多实例下内存桶仅对本实例有效，属尽力而为；
 * 按 API Key 指纹限流，避免公司 NAT 下「全员共 IP」误伤。
 * 可用环境变量覆盖：API_RL_MAX_<ROUTE>（如 API_RL_MAX_QWEN=400）。
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export const checkApiRateLimit = (
  key: string,
  opts?: { windowMs?: number; max?: number }
): { ok: boolean; retryAfterSec: number } => {
  const windowMs = opts?.windowMs ?? 60_000;
  const max = opts?.max ?? 120;
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (cur.count >= max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  cur.count += 1;
  return { ok: true, retryAfterSec: 0 };
};

export const clientIpFromReq = (req: { headers?: Record<string, unknown> }): string => {
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]);
  return 'unknown';
};

const fingerprint = (raw: string): string => {
  const s = (raw || '').replace(/^Bearer\s+/i, '').trim();
  if (!s) return '';
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
};

export type ApiRateRoute =
  | 'qwen'
  | 'tavily'
  | 'anysearch'
  | 'anymail'
  | 'hunter'
  | 'tokenhub'
  | 'tripo'
  | 'dashscope'
  | 'directmail'
  | 'social'
  | 'landing';

/** 默认按「约 50 人同钥/同网」峰值估算；可用环境变量覆盖 */
const DEFAULT_MAX: Record<ApiRateRoute, number> = {
  qwen: 360,
  tavily: 180,
  anysearch: 120,
  anymail: 120,
  hunter: 90,
  tokenhub: 60,
  tripo: 60,
  dashscope: 90,
  directmail: 60,
  social: 90,
  landing: 600,
};

const envMax = (route: ApiRateRoute): number => {
  const k = `API_RL_MAX_${route.toUpperCase()}`;
  const n = Number(process.env[k] || '');
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return DEFAULT_MAX[route];
};

const extractClientCredential = (req: {
  headers?: Record<string, unknown>;
}): string => {
  const h = req.headers || {};
  const candidates = [
    h.authorization,
    h['x-upstream-authorization'],
    h['x-goog-api-key'],
    h.apikey,
  ];
  for (const c of candidates) {
    const v = Array.isArray(c) ? c[0] : c;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
};

/**
 * 挂到 handler 开头（OPTIONS 之后）。返回 false 表示已写 429，应直接 return。
 */
export const enforceApiRateLimit = (
  req: { headers?: Record<string, unknown> },
  res: {
    status: (code: number) => { json: (body: unknown) => void; setHeader?: (k: string, v: string) => void };
    setHeader: (k: string, v: string) => void;
  },
  route: ApiRateRoute
): boolean => {
  const ip = clientIpFromReq(req);
  const cred = extractClientCredential(req);
  const fp = fingerprint(cred);
  const bucketKey = fp ? `${route}:k:${fp}` : `${route}:ip:${ip}`;
  const max = envMax(route);
  const r = checkApiRateLimit(bucketKey, { windowMs: 60_000, max });
  if (r.ok) return true;
  res.setHeader('Retry-After', String(r.retryAfterSec));
  res.setHeader('Cache-Control', 'no-store');
  res.status(429).json({
    error: `请求过于频繁，请 ${r.retryAfterSec} 秒后再试`,
    retryAfterSec: r.retryAfterSec,
    route,
  });
  return false;
};
