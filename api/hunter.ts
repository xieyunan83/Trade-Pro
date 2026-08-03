/**
 * Vercel Serverless：同域转发 Hunter.io（零外部 import）
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

const ORIGIN = 'https://api.hunter.io';
const UPSTREAM_TIMEOUT_MS = 25_000;

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

const resolveUpstreamPath = (req: any): string => {
  const raw = req.query?.__upstream;
  const fromQuery = Array.isArray(raw) ? raw[0] : raw ? String(raw) : '';
  if (fromQuery) {
    try {
      const decoded = decodeURIComponent(fromQuery);
      return decoded.startsWith('/') ? decoded : `/${decoded}`;
    } catch {
      return fromQuery.startsWith('/') ? fromQuery : `/${fromQuery}`;
    }
  }
  return '/v2/account';
};

export default async function handler(req: any, res: any) {
  try {
    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const path = resolveUpstreamPath(req);
      const target = new URL(path, ORIGIN + '/');

      const q = req.query || {};
      for (const [k, v] of Object.entries(q)) {
        if (k === '__upstream') continue;
        if (v == null) continue;
        target.searchParams.set(k, Array.isArray(v) ? String(v[0]) : String(v));
      }

      const upstream = await fetch(target.toString(), {
        method: 'GET',
        signal: controller.signal,
      });

      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      res.send(text);
    } catch (e: any) {
      const aborted = e?.name === 'AbortError';
      res.status(aborted ? 504 : 502).json({
        errors: [
          {
            id: aborted ? 'timeout' : 'proxy_error',
            details: aborted
              ? `Hunter 上游超时（${UPSTREAM_TIMEOUT_MS / 1000}s）`
              : e?.message || 'proxy failed',
          },
        ],
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    try {
      if (!res.headersSent) res.status(500).json({ error: e?.message || 'hunter proxy crashed' });
    } catch {
      /* ignore */
    }
  }
}
