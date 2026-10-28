/**
 * 百炼临时存储：本地图 → oss:// URL（约 48h），供千问通道 Tripo 图生 3D。
 * 凭证走同域 /qwen-api|/api/qwen；文件直传 upload_host（OSS 表单）。
 */
import {
  buildAliyunFetchHeaders,
  isLocalDevHost,
  qwenCorsHint,
} from './qwenProxy';
import { compressImageDataUrl } from './catalogExcelService';

const UPLOADS_PATH = '/api/v1/uploads';
/** 官方临时上传文档默认北京站；与 MaaS 网关 Key 可能互通，失败再回退调用方 Origin */
export const DASHSCOPE_UPLOAD_ORIGIN = 'https://dashscope.aliyuncs.com';

const sanitizeKey = (k: string) =>
  (k || '')
    .replace(/^\uFEFF/, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();

type PolicyData = {
  policy: string;
  signature: string;
  upload_dir: string;
  upload_host: string;
  oss_access_key_id: string;
  x_oss_object_acl: string;
  x_oss_forbid_overwrite: string;
};

const buildProxyUrl = (origin: string, pathWithQuery: string): { url: string; proxyOrigin: string } => {
  const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  if (isLocalDevHost()) {
    return { url: `/qwen-api${path}`, proxyOrigin: origin };
  }
  // 整段 path+query 放进 __upstream，与 wan/视频一致
  return {
    url: `/api/qwen?__upstream=${encodeURIComponent(path)}`,
    proxyOrigin: origin,
  };
};

const getPolicy = async (apiKey: string, model: string, origin: string): Promise<PolicyData> => {
  const q = `${UPLOADS_PATH}?action=getPolicy&model=${encodeURIComponent(model)}`;
  const { url, proxyOrigin } = buildProxyUrl(origin, q);
  // 勿带 X-Upstream-Path：否则会盖掉 __upstream 里的 ?action=getPolicy&model=
  const headers = buildAliyunFetchHeaders({
    targetUrl: url,
    apiKey,
    proxyOrigin,
  });
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`获取上传凭证失败（非 JSON）：${text.slice(0, 160)}`);
  }
  if (!res.ok) {
    throw new Error(json.message || json.code || `获取上传凭证失败 HTTP ${res.status}`);
  }
  const data = json.data || json.output || json;
  if (!data?.upload_host || !data?.policy) {
    throw new Error('上传凭证缺少 upload_host / policy');
  }
  return data as PolicyData;
};

const dataUrlToBlob = async (dataUrl: string): Promise<{ blob: Blob; filename: string }> => {
  let url = dataUrl;
  if (url.startsWith('data:image/') && url.length > 900_000) {
    url = await compressImageDataUrl(url, 1280, 0.82);
  } else if (url.startsWith('data:image/') && url.length > 450_000) {
    url = await compressImageDataUrl(url, 1600, 0.88);
  }
  const m = /^data:([^;]+);base64,(.+)$/i.exec(url);
  if (!m) throw new Error('参考图格式无效，请使用 JPG/PNG');
  const mime = (m[1] || 'image/jpeg').toLowerCase();
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return {
    blob: new Blob([bytes], { type: mime }),
    filename: `ref_${Date.now()}.${ext}`,
  };
};

const postOssForm = async (policy: PolicyData, blob: Blob, filename: string): Promise<string> => {
  const key = `${policy.upload_dir.replace(/\/$/, '')}/${filename}`;
  const form = new FormData();
  form.append('OSSAccessKeyId', policy.oss_access_key_id);
  form.append('Signature', policy.signature);
  form.append('policy', policy.policy);
  form.append('x-oss-object-acl', policy.x_oss_object_acl);
  form.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite);
  form.append('key', key);
  form.append('success_action_status', '200');
  form.append('file', blob, filename);

  const res = await fetch(policy.upload_host, { method: 'POST', body: form });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`临时图上传失败 HTTP ${res.status}${t ? `：${t.slice(0, 120)}` : ''}`);
  }
  return `oss://${key}`;
};

/**
 * 将 data: 或本地图上传为 oss:// 临时地址。
 * @param preferOrigin 优先用调用方 MaaS Origin 取凭证，失败再试 dashscope.aliyuncs.com
 */
export const uploadLocalImageToDashscopeTemp = async (opts: {
  apiKey: string;
  modelId: string;
  image: string;
  preferOrigin?: string;
}): Promise<string> => {
  const apiKey = sanitizeKey(opts.apiKey);
  if (!apiKey) throw new Error('缺少 API Key，无法上传参考图');
  if (/^https?:\/\//i.test(opts.image.trim())) return opts.image.trim();
  if (!opts.image.startsWith('data:image/')) {
    throw new Error('参考图须为本地上传图片或公网 HTTPS 地址');
  }

  const { blob, filename } = await dataUrlToBlob(opts.image);
  const origins = [
    opts.preferOrigin?.trim(),
    DASHSCOPE_UPLOAD_ORIGIN,
  ].filter(Boolean) as string[];
  const unique = [...new Set(origins.map((o) => {
    try {
      return new URL(o).origin;
    } catch {
      return o;
    }
  }))];

  let lastErr: Error | null = null;
  for (const origin of unique) {
    try {
      const policy = await getPolicy(apiKey, opts.modelId, origin);
      return await postOssForm(policy, blob, filename);
    } catch (e: any) {
      lastErr = new Error(String(e?.message || e) + qwenCorsHint(e?.message));
    }
  }

  // 浏览器直传 OSS 若遇 CORS，走同域服务端上传
  try {
    const m = /^data:([^;]+);base64,(.+)$/i.exec(
      opts.image.length > 900_000
        ? await compressImageDataUrl(opts.image, 1280, 0.82)
        : opts.image
    );
    if (!m?.[2]) throw lastErr || new Error('参考图无效');
    const res = await fetch('/api/dashscope-upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.modelId,
        origin: unique[0],
        contentType: m[1] || 'image/jpeg',
        contentBase64: m[2],
        filename,
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json.url) {
      throw new Error(json.error || `服务端上传失败 HTTP ${res.status}`);
    }
    return String(json.url);
  } catch (e: any) {
    throw lastErr || new Error(String(e?.message || e));
  }
};
