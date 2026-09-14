/**
 * API 侧轻量防火墙辅助（供 serverless handlers 引用）
 * 与 services/appFirewall.ts 对应；此前注释提到的缺失文件。
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
