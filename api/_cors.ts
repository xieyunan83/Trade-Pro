/**
 * 严格 CORS：仅放行自家站点 Origin，杜绝任意站跨域白嫖代理。
 * 无 Origin（同机/服务端调用）放行；未知 Origin 不回 Access-Control-Allow-Origin。
 */

const DEFAULT_ALLOWED = [
  'https://babyworld.ltd',
  'https://www.babyworld.ltd',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

let cached: Set<string> | null = null;

const allowedOrigins = (): Set<string> => {
  if (cached) return cached;
  const extra = String(process.env.ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const primary = String(process.env.APP_ORIGIN || process.env.TRADE_APP_ORIGIN || '')
    .trim()
    .replace(/\/$/, '');
  cached = new Set([...DEFAULT_ALLOWED, ...extra, ...(primary ? [primary] : [])]);
  return cached;
};

const isAllowedOrigin = (origin: string): boolean => {
  if (!origin) return false;
  const o = origin.replace(/\/$/, '');
  if (allowedOrigins().has(o)) return true;
  if (process.env.CORS_ALLOW_VERCEL_PREVIEWS === '1' && /\.vercel\.app$/i.test(o)) {
    return true;
  }
  return false;
};

type ResLike = {
  setHeader: (k: string, v: string) => void;
  status: (n: number) => { end: (b?: unknown) => void; json: (b: unknown) => void };
};

/** 写入 CORS 头；未知 Origin 时返回 false */
export const applyStrictCors = (
  req: { headers?: Record<string, unknown>; method?: string },
  res: { setHeader: (k: string, v: string) => void }
): boolean => {
  const raw = req.headers?.origin;
  const origin = typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? String(raw[0] || '') : '';
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, authorization, x-goog-api-key, x-qwen-origin, x-upstream-authorization, apikey, x-industry-token'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (!origin) return true;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    return true;
  }
  return false;
};

/**
 * 统一处理 OPTIONS；返回 true 表示已结束响应。
 * 非法 Origin → 403。
 */
export const handleCorsPreflight = (req: any, res: ResLike): boolean => {
  if (String(req.method || '').toUpperCase() !== 'OPTIONS') return false;
  const ok = applyStrictCors(req, res);
  if (!ok) {
    res.status(403).json({ ok: false, error: 'Origin not allowed' });
    return true;
  }
  res.status(204).end();
  return true;
};
