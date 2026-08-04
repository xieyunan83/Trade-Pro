/**
 * Vercel Serverless：同域转发 Tavily API
 * 用法：/api/tavily?__upstream=/search 或 /extract
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

const ORIGIN = 'https://api.tavily.com';
const UPSTREAM_TIMEOUT_MS = 45_000;

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-upstream-authorization, x-upstream-path'
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
  return '/search';
};

export default async function handler(req: any, res: any) {
  try {
    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Tavily proxy only accepts POST' });
      return;
    }

    const clientAuth = req.headers.authorization || req.headers['x-upstream-authorization'];
    const serverKey = String(process.env.TAVILY_API_KEY || '').trim();
    let auth = '';
    if (clientAuth) {
      const raw = String(clientAuth).replace(/^Bearer\s+/i, '').trim();
      auth = raw ? `Bearer ${raw}` : '';
    } else if (serverKey) {
      auth = `Bearer ${serverKey.replace(/^Bearer\s+/i, '')}`;
    }
    if (!auth) {
      res.status(401).json({
        error: '未配置 Tavily API Key。请在管理后台保存，或设置服务端 TAVILY_API_KEY。',
      });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const path = resolveUpstreamPath(req);
      const target = new URL(path, ORIGIN + '/');
      const upstream = await fetch(target.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: auth,
        },
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
        error: aborted ? `Tavily 上游超时（${UPSTREAM_TIMEOUT_MS / 1000}s）` : e?.message || String(e),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    try {
      applyCors(res);
      if (!res.headersSent) res.status(500).json({ error: e?.message || 'tavily proxy crashed' });
    } catch {
      /* ignore */
    }
  }
}
