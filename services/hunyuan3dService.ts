/**
 * 腾讯混元生 3D（TokenHub）：提交 → 轮询 → GLB。
 * Key 来自管理后台「数据接入 · 图生 3D（备选）」。
 */
import { isLocalDevHost } from './qwenProxy';
import {
  loadDataProvider,
  loadDataProviderLocal,
  saveDataProviderLocal,
  type DataProviderMeta,
} from './dataProviders';
import { compressImageDataUrl } from './catalogExcelService';
import { humanizeCreativeProviderError } from './providerErrorMessage';
import type { Model3dGenerateInput, Model3dGenerateResult } from './model3dService';

const MODEL_ID = 'hy-3d-3.1';
const SUBMIT_PATH = '/v1/api/3d/submit';
const QUERY_PATH = '/v1/api/3d/query';

const sanitizeKey = (k: string) =>
  (k || '')
    .replace(/^\uFEFF/, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const getHunyuan3dProviderStatus = (): {
  ready: boolean;
  detail: string;
  hasKey: boolean;
} => {
  const meta = loadDataProviderLocal('hunyuan3d');
  const key = sanitizeKey(meta.apiKey || '');
  if (key && meta.enabled) {
    return { ready: true, detail: '混元 3D 备选已就绪', hasKey: true };
  }
  if (key && !meta.enabled) {
    return {
      ready: false,
      detail: '已填写混元 Key，请在「数据接入」打开「图生 3D（备选）」开关',
      hasKey: true,
    };
  }
  return { ready: false, detail: '未配置混元 3D 备选 Key', hasKey: false };
};

export const hydrateHunyuan3dProvider = async () => {
  try {
    const cloud = await loadDataProvider('hunyuan3d');
    if (sanitizeKey(cloud.apiKey || '') && !cloud.enabled) {
      saveDataProviderLocal('hunyuan3d', { ...cloud, enabled: true });
    }
  } catch {
    /* local ok */
  }
  return getHunyuan3dProviderStatus();
};

const resolveMeta = (): DataProviderMeta & { apiKey: string } => {
  const meta = loadDataProviderLocal('hunyuan3d');
  const apiKey = sanitizeKey(meta.apiKey || '');
  if (!apiKey) {
    throw new Error('未配置混元 3D API Key。请在「数据接入 → 图生 3D（备选）」填写 TokenHub Key。');
  }
  if (!meta.enabled) {
    saveDataProviderLocal('hunyuan3d', { ...meta, enabled: true, apiKey });
  }
  return { ...meta, enabled: true, apiKey };
};

const hubUrl = (path: string): string => {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (isLocalDevHost()) return `/tokenhub-api${p}`;
  return `/api/tokenhub?__upstream=${encodeURIComponent(p)}`;
};

const parseJson = async (res: Response): Promise<any> => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`混元 3D 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 180)}`);
  }
};

const toRawBase64 = async (sourceImage: string): Promise<{ b64?: string; url?: string }> => {
  if (/^https?:\/\//i.test(sourceImage)) return { url: sourceImage };
  let dataUrl = sourceImage;
  if (dataUrl.startsWith('data:image/') && dataUrl.length > 400_000) {
    dataUrl = await compressImageDataUrl(dataUrl, 1280, 0.78);
  }
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m?.[2]) throw new Error('参考图格式无效');
  return { b64: m[2] };
};

const createTask = async (apiKey: string, body: Record<string, unknown>): Promise<string> => {
  const res = await fetch(hubUrl(SUBMIT_PATH), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Upstream-Path': SUBMIT_PATH,
    },
    body: JSON.stringify(body),
  });
  const json = await parseJson(res);
  if (!res.ok) {
    throw new Error(
      humanizeCreativeProviderError(json.message || json.error || json.code || `创建失败 HTTP ${res.status}`)
    );
  }
  const id = json.id || json.data?.id || json.task_id;
  if (!id) throw new Error('混元任务已提交但未返回任务 ID');
  return String(id);
};

const pollTask = async (
  apiKey: string,
  taskId: string,
  onProgress?: (pct: number, status: string) => void
): Promise<any> => {
  for (let i = 0; i < 120; i++) {
    const res = await fetch(hubUrl(QUERY_PATH), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Upstream-Path': QUERY_PATH,
      },
      body: JSON.stringify({ model: MODEL_ID, id: taskId }),
    });
    const json = await parseJson(res);
    if (!res.ok && !json.status) {
      throw new Error(humanizeCreativeProviderError(json.message || `查询失败 HTTP ${res.status}`));
    }
    const status = String(json.status || '').toLowerCase();
    const pct =
      status === 'completed'
        ? 100
        : status === 'in_progress'
          ? Math.min(92, 12 + i * 1.5)
          : Math.min(25, 5 + i);
    onProgress?.(pct, status || 'running');

    if (status === 'completed') return json;
    if (status === 'failed') {
      throw new Error(humanizeCreativeProviderError(json.message || json.error || '混元 3D 生成失败'));
    }
    await sleep(2500);
  }
  throw new Error('混元 3D 生成超时，请稍后在项目库重试');
};

const pickUrls = (data: any, taskId: string): Model3dGenerateResult => {
  const rows = Array.isArray(data?.data) ? data.data : [];
  const glb = rows.find((r: any) => String(r?.type || '').toLowerCase() === 'glb');
  const anyMesh = glb || rows.find((r: any) => r?.url) || rows[0];
  const modelUrl = String(anyMesh?.url || '');
  if (!modelUrl) throw new Error('任务完成但未返回模型下载地址');
  const preview =
    rows.find((r: any) => r?.preview_image_url)?.preview_image_url ||
    anyMesh?.preview_image_url ||
    '';
  return {
    taskId,
    modelUrl,
    previewImageUrl: preview ? String(preview) : undefined,
    pbrModelUrl: glb?.url ? String(glb.url) : undefined,
    raw: data,
  };
};

/** 混元图/文生 3D */
export const generateHunyuanModel3d = async (
  input: Model3dGenerateInput
): Promise<Model3dGenerateResult> => {
  const { apiKey } = resolveMeta();
  input.onProgress?.(2, 'queued');

  // hy-3d-3.1 不支持 LowPoly / Sketch；统一 Normal + face_count
  const body: Record<string, unknown> = {
    model: MODEL_ID,
    generate_type: 'Normal',
    enable_pbr: true,
    face_count: input.quality === 'engine_ready' ? 20000 : 150000,
  };

  if (input.mode === 'text') {
    const prompt = (input.prompt || '').trim();
    if (!prompt) throw new Error('请填写文字描述');
    body.prompt = prompt;
  } else {
    const imgs = (
      input.sourceImages?.length
        ? input.sourceImages
        : input.sourceImage
          ? [input.sourceImage]
          : []
    )
      .map((u) => (u || '').trim())
      .filter(Boolean)
      .slice(0, 4);
    if (!imgs.length) throw new Error('请上传或选用产品图');

    if (imgs.length >= 2) {
      // 多视角：首张作主图，其余按 left/back/right 尽量填
      const views = ['left', 'back', 'right'] as const;
      const multi: Array<{ view_type: string; view_image_url?: string; view_image_base64?: string }> =
        [];
      const main = await toRawBase64(imgs[0]);
      if (main.url) body.image_url = main.url;
      else body.image_base64 = main.b64;
      for (let i = 1; i < imgs.length && i - 1 < views.length; i++) {
        const packed = await toRawBase64(imgs[i]);
        const item: { view_type: string; view_image_url?: string; view_image_base64?: string } = {
          view_type: views[i - 1],
        };
        if (packed.url) item.view_image_url = packed.url;
        else item.view_image_base64 = packed.b64;
        multi.push(item);
      }
      if (multi.length) body.multi_view_images = multi;
    } else {
      const packed = await toRawBase64(imgs[0]);
      if (packed.url) body.image_url = packed.url;
      else body.image_base64 = packed.b64;
      if (input.prompt?.trim() && input.mode === 'image') {
        // 混元：prompt 与 image 一般互斥；仅 Sketch 可同传，这里不附 prompt
      }
    }
  }

  input.onProgress?.(8, 'submitted');
  const taskId = await createTask(apiKey, body);
  input.onProgress?.(12, 'running');
  const data = await pollTask(apiKey, taskId, input.onProgress);
  return pickUrls(data, taskId);
};
