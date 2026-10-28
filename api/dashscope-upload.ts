/**
 * 服务端：本地图 → 百炼临时 oss://（避免浏览器直传 OSS 的 CORS 问题）。
 * POST JSON: { model, filename?, contentType?, contentBase64 }
 * Header: Authorization: Bearer <apiKey>
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: '12mb' } },
};

const DEFAULT_ORIGIN = 'https://dashscope.aliyuncs.com';

const applyCors = (res: { setHeader: (k: string, v: string) => void }) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
};

const sanitizeKey = (k: string) =>
  String(k || '')
    .replace(/^\uFEFF/, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();

export default async function handler(req: any, res: any) {
  try {
    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Only POST' });
      return;
    }

    const apiKey = sanitizeKey(req.headers.authorization || '');
    if (!apiKey) {
      res.status(401).json({ error: 'Missing Authorization Bearer API Key' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const model = String(body.model || 'Tripo/Tripo-H3.1').trim();
    const preferOrigin = String(body.origin || '').trim();
    const contentBase64 = String(body.contentBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!contentBase64) {
      res.status(400).json({ error: 'contentBase64 required' });
      return;
    }
    const contentType = String(body.contentType || 'image/jpeg');
    const filename =
      String(body.filename || '').trim() ||
      `ref_${Date.now()}.${contentType.includes('png') ? 'png' : 'jpg'}`;

    const origins = [preferOrigin, DEFAULT_ORIGIN].filter(Boolean);
    const unique = [...new Set(origins.map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return o;
      }
    }))];

    let lastErr = '';
    for (const origin of unique) {
      try {
        const policyUrl = `${origin}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`;
        const polRes = await fetch(policyUrl, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });
        const polJson: any = await polRes.json().catch(() => ({}));
        if (!polRes.ok) {
          lastErr = polJson.message || polJson.code || `getPolicy HTTP ${polRes.status}`;
          continue;
        }
        const data = polJson.data || polJson;
        if (!data?.upload_host || !data?.policy) {
          lastErr = 'policy missing fields';
          continue;
        }

        const key = `${String(data.upload_dir).replace(/\/$/, '')}/${filename}`;
        const buf = Buffer.from(contentBase64, 'base64');
        const form = new FormData();
        form.append('OSSAccessKeyId', data.oss_access_key_id);
        form.append('Signature', data.signature);
        form.append('policy', data.policy);
        form.append('x-oss-object-acl', data.x_oss_object_acl);
        form.append('x-oss-forbid-overwrite', data.x_oss_forbid_overwrite);
        form.append('key', key);
        form.append('success_action_status', '200');
        form.append('file', new Blob([buf], { type: contentType }), filename);

        const up = await fetch(data.upload_host, { method: 'POST', body: form });
        if (!up.ok) {
          lastErr = `OSS upload HTTP ${up.status}`;
          continue;
        }
        res.status(200).json({ url: `oss://${key}` });
        return;
      } catch (e: any) {
        lastErr = e?.message || String(e);
      }
    }

    res.status(502).json({ error: lastErr || 'upload failed' });
  } catch (e: any) {
    applyCors(res);
    if (!res.headersSent) res.status(500).json({ error: e?.message || 'upload crashed' });
  }
}
