/**
 * Vercel Serverless（Node）：同域转发 Anymail Finder
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

const ORIGIN = 'https://api.anymailfinder.com';

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-qwen-origin, x-upstream-authorization, apikey'
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

export default async function handler(req: any, res: any) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const parts = req.query?.path;
    const suffix = Array.isArray(parts) ? parts.join('/') : parts ? String(parts) : '';
    const target = new URL(suffix ? `/${suffix}` : '/', ORIGIN + '/');

    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query || {})) {
      if (k === 'path') continue;
      if (Array.isArray(v)) v.forEach((x) => q.append(k, String(x)));
      else if (v != null) q.set(k, String(v));
    }
    const qs = q.toString();
    if (qs) target.search = qs;

    const headers: Record<string, string> = {};
    const ct = req.headers['content-type'];
    if (ct) headers['Content-Type'] = String(ct);
    else if (req.method !== 'GET' && req.method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }
    const auth = req.headers.authorization || req.headers['x-upstream-authorization'];
    if (auth) headers.Authorization = String(auth).replace(/^Bearer\s+/i, '').trim();

    const body = readBody(req);
    const upstream = await fetch(target.toString(), {
      method: req.method || 'POST',
      headers,
      body,
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
    res.status(502).json({ error: e?.message || String(e) });
  }
}
