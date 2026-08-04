/**
 * Vercel Serverless：同域转发 Google Generative Language API
 * - 仅使用 x-goog-api-key（兼容 AIza / AQ. Auth Key）
 * - 绝不转发 Authorization: Bearer（否则会触发 ACCESS_TOKEN_TYPE_UNSUPPORTED）
 * 用法：/api/gemini?__upstream=/v1beta/models/gemini-2.0-flash:generateContent
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
};

const ORIGIN = 'https://generativelanguage.googleapis.com';
const UPSTREAM_TIMEOUT_MS = 280_000;

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, x-goog-api-key, x-upstream-path'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

const readBody = (req: { method?: string; body?: unknown }): string | undefined => {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const b = req.body;
  if (b == null || b === '') return undefined;
  if (typeof b === 'string') return b;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(b)) return b.toString('utf8');
  try {
    return JSON.stringify(b);
  } catch {
    return String(b);
  }
};

const resolveUpstreamPath = (req: any): string => {
  const hdr = req.headers?.['x-upstream-path'];
  if (typeof hdr === 'string' && hdr.startsWith('/')) return hdr;

  const raw = req.query?.__upstream;
  const fromQuery = Array.isArray(raw) ? raw.join('/') : raw ? String(raw) : '';
  if (fromQuery) {
    try {
      const decoded = decodeURIComponent(fromQuery);
      return decoded.startsWith('/') ? decoded : `/${decoded}`;
    } catch {
      return fromQuery.startsWith('/') ? fromQuery : `/${fromQuery}`;
    }
  }
  return '/v1beta/models';
};

const extractApiKey = (req: any): string => {
  const hdr = req.headers?.['x-goog-api-key'];
  const raw = Array.isArray(hdr) ? hdr[0] : hdr;
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();
};

export default async function handler(req: any, res: any) {
  try {
    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const method = String(req.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'HEAD'].includes(method)) {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const apiKey = extractApiKey(req);
    if (!apiKey) {
      res.status(401).json({
        error:
          '缺少 x-goog-api-key。请在管理后台填写 Gemini 官方 Key（AIza… 或 AQ.…）。',
      });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const path = resolveUpstreamPath(req);
      const target = new URL(path, ORIGIN + '/');

      const headers: Record<string, string> = {
        'x-goog-api-key': apiKey,
      };
      const ct = req.headers['content-type'];
      if (ct) headers['Content-Type'] = String(ct);
      else if (method !== 'GET' && method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
      }

      const upstream = await fetch(target.toString(), {
        method: method === 'HEAD' ? 'GET' : method,
        headers,
        body: readBody(req),
        signal: controller.signal,
      });

      const text = await upstream.text();
      applyCors(res);
      res.status(upstream.status);
      res.setHeader('X-Proxied-To', ORIGIN);
      res.setHeader('Cache-Control', 'no-store');
      const uct = upstream.headers.get('content-type');
      if (uct) res.setHeader('Content-Type', uct);
      res.send(text);
    } catch (e: any) {
      applyCors(res);
      const aborted = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e?.message || e));
      res.status(aborted ? 504 : 502).json({
        error: aborted
          ? `Gemini 上游超时（${UPSTREAM_TIMEOUT_MS / 1000}s）`
          : e?.message || String(e),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    try {
      applyCors(res);
      if (!res.headersSent) res.status(500).json({ error: e?.message || 'gemini proxy crashed' });
    } catch {
      /* ignore */
    }
  }
}
