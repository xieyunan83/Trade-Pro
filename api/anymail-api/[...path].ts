/**
 * Vercel Serverless：同域转发 Anymail Finder（解决浏览器 CORS）
 */
export const config = {
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

const ORIGIN = 'https://api.anymailfinder.com';

const cors = (res: any) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-qwen-origin, x-upstream-authorization, apikey'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

export default async function handler(req: any, res: any) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const parts = req.query.path;
    const suffix = Array.isArray(parts) ? parts.join('/') : parts ? String(parts) : '';
    const target = new URL(suffix ? `/${suffix}` : '/', ORIGIN + '/');

    const headers: Record<string, string> = {
      'Content-Type': (req.headers['content-type'] as string) || 'application/json',
    };
    const auth = req.headers.authorization || req.headers['x-upstream-authorization'];
    if (auth) headers.Authorization = String(auth).replace(/^Bearer\s+/i, '').trim();

    const upstream = await fetch(target.toString(), {
      method: req.method || 'POST',
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body ?? {}),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('X-Proxied-To', ORIGIN);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    cors(res);
    res.send(text);
  } catch (e: any) {
    cors(res);
    res.status(502).json({ error: e?.message || String(e) });
  }
}
