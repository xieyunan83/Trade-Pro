/**
 * 图/文生 3D：经同域代理调用 OpenAPI（上传 → 建任务 → 轮询 → GLB）。
 * Key：管理后台「数据接入 · 图生 3D API」或环境变量；进入模块时会拉取云端配置。
 */
import { env } from './env';
import { isLocalDevHost } from './qwenProxy';
import {
  loadDataProvider,
  loadDataProviderLocal,
  saveDataProviderLocal,
  type DataProviderMeta,
} from './dataProviders';
import { compressImageDataUrl } from './catalogExcelService';

export type Model3dGenerateInput = {
  mode: 'image' | 'text';
  prompt?: string;
  /** data:image/...;base64,... 或 https URL */
  sourceImage?: string;
  quality: 'high_detail' | 'engine_ready';
  onProgress?: (pct: number, status: string) => void;
};

export type Model3dGenerateResult = {
  taskId: string;
  modelUrl: string;
  previewImageUrl?: string;
  pbrModelUrl?: string;
  baseModelUrl?: string;
  raw?: unknown;
};

const sanitizeKey = (k: string) =>
  (k || '')
    .replace(/^\uFEFF/, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();

const pickKey = (meta: DataProviderMeta): string =>
  sanitizeKey(meta.apiKey || '') || sanitizeKey(env.tripoApiKey || '');

export const getModel3dProviderStatus = (): {
  ready: boolean;
  detail: string;
  hasKey: boolean;
  enabled: boolean;
} => {
  const meta = loadDataProviderLocal('tripo');
  const key = pickKey(meta);
  const hasKey = !!key;
  const enabled = !!(meta.enabled || sanitizeKey(env.tripoApiKey || ''));
  if (hasKey && enabled) {
    return { ready: true, detail: '3D 服务已就绪', hasKey, enabled: true };
  }
  if (hasKey && !meta.enabled) {
    return {
      ready: false,
      detail: '已填写 Key，请在「数据接入」打开「图生 3D API」开关',
      hasKey,
      enabled: false,
    };
  }
  return {
    ready: false,
    detail: '请先配置图生 3D API Key（系统管理 → 数据接入，或本页管理员快捷配置）',
    hasKey: false,
    enabled: false,
  };
};

/** 进入 3D 模块时拉取云端配置，避免「后台已配、前台仍无 Key」 */
export const hydrateModel3dProvider = async (): Promise<ReturnType<typeof getModel3dProviderStatus>> => {
  try {
    const cloud = await loadDataProvider('tripo');
    // 有 Key 但未开开关时自动启用，避免演示时「点了没反应」
    if (sanitizeKey(cloud.apiKey || '') && !cloud.enabled) {
      saveDataProviderLocal('tripo', { ...cloud, enabled: true });
    }
  } catch {
    /* 本地即可 */
  }
  return getModel3dProviderStatus();
};

const resolveMeta = (): DataProviderMeta & { apiKey: string } => {
  const meta = loadDataProviderLocal('tripo');
  const apiKey = pickKey(meta);
  if (!apiKey) {
    throw new Error('未配置图生 3D API。请管理员在「系统管理 → 数据接入 → 图生 3D API」启用并填写 Key。');
  }
  if (!meta.enabled && !sanitizeKey(env.tripoApiKey || '')) {
    // 有本地 Key 但未启用：自动启用一次，方便演示
    saveDataProviderLocal('tripo', { ...meta, enabled: true, apiKey });
  }
  return { ...meta, enabled: true, apiKey };
};

const tripoUrl = (path: string): string => {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (isLocalDevHost()) return `/tripo-api${p}`;
  return `/api/tripo?__upstream=${encodeURIComponent(p)}`;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const parseJson = async (res: Response): Promise<any> => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`3D 服务返回非 JSON（HTTP ${res.status}）：${text.slice(0, 180)}`);
  }
};

const throwIfApiError = (res: Response, json: any, fallback: string) => {
  if (res.ok && (json.code == null || json.code === 0)) return;
  const msg =
    json?.message ||
    json?.error ||
    json?.data?.message ||
    (typeof json?.error === 'string' ? json.error : '') ||
    fallback;
  throw new Error(String(msg));
};

/** dataURL → Blob */
const dataUrlToBlob = async (dataUrl: string): Promise<{ blob: Blob; filename: string }> => {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error('图片格式无效，请重新上传');
  const mime = m[1] || 'image/jpeg';
  const bin = atob(m[2]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return { blob: new Blob([arr], { type: mime }), filename: `input.${ext}` };
};

/** 压缩大图，避免代理体积上限导致「点了没反应 / 上传失败」 */
const prepareSourceImage = async (sourceImage: string): Promise<string> => {
  if (!sourceImage.startsWith('data:image/')) return sourceImage;
  // 粗略估体积：base64 过长则压到 1280 边
  if (sourceImage.length > 900_000) {
    return compressImageDataUrl(sourceImage, 1280, 0.78);
  }
  if (sourceImage.length > 400_000) {
    return compressImageDataUrl(sourceImage, 1536, 0.82);
  }
  return sourceImage;
};

/** 上传本地图，返回 file/image token（优先 /upload/sts，失败回退 /upload） */
const uploadImage = async (
  apiKey: string,
  sourceImage: string
): Promise<{ token: string; fileType: string }> => {
  if (/^https?:\/\//i.test(sourceImage)) {
    const ext = sourceImage.toLowerCase().includes('.png')
      ? 'png'
      : sourceImage.toLowerCase().includes('.webp')
        ? 'webp'
        : 'jpg';
    return { token: '', fileType: ext };
  }

  const prepared = await prepareSourceImage(sourceImage);
  const { blob, filename } = await dataUrlToBlob(prepared);
  if (blob.size > 9.5 * 1024 * 1024) {
    throw new Error('参考图过大（需小于 10MB），请换一张或先压缩后再试');
  }

  const tryUpload = async (path: string) => {
    const form = new FormData();
    form.append('file', blob, filename);
    const res = await fetch(tripoUrl(path), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const json = await parseJson(res);
    throwIfApiError(res, json, `上传失败 HTTP ${res.status}`);
    const token =
      json.data?.image_token ||
      json.data?.file_token ||
      json.image_token ||
      json.file_token ||
      '';
    if (!token) throw new Error('上传成功但未返回 image_token');
    return token as string;
  };

  let token: string;
  try {
    token = await tryUpload('/v2/openapi/upload/sts');
  } catch (e1: any) {
    try {
      token = await tryUpload('/v2/openapi/upload');
    } catch {
      throw new Error(e1?.message || '参考图上传失败');
    }
  }

  const fileType = filename.split('.').pop() || 'jpg';
  return { token, fileType: fileType === 'jpg' ? 'jpeg' : fileType };
};

const createTask = async (apiKey: string, body: Record<string, unknown>): Promise<string> => {
  const res = await fetch(tripoUrl('/v2/openapi/task'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await parseJson(res);
  throwIfApiError(res, json, `创建任务失败 HTTP ${res.status}`);
  const taskId = json.data?.task_id || json.task_id;
  if (!taskId) throw new Error('创建任务成功但未返回 task_id');
  return String(taskId);
};

const pollTask = async (
  apiKey: string,
  taskId: string,
  onProgress?: (pct: number, status: string) => void
): Promise<any> => {
  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(tripoUrl(`/v2/openapi/task/${encodeURIComponent(taskId)}`), {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const json = await parseJson(res);
    if (!res.ok || (json.code != null && json.code !== 0 && json.data?.status == null)) {
      throw new Error(json.message || json.error || `查询任务失败 HTTP ${res.status}`);
    }
    const data = json.data || json;
    const status = String(data.status || '').toLowerCase();
    const progress = typeof data.progress === 'number' ? data.progress : Math.min(95, i * 2);
    onProgress?.(progress, status || 'running');

    if (status === 'success' || status === 'succeeded' || status === 'completed') {
      return data;
    }
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(data.error_msg || data.message || `3D 生成失败（${status}）`);
    }
    await sleep(2500);
  }
  throw new Error('3D 生成超时，请稍后在项目库重试或检查账户额度');
};

const pickUrls = (data: any): Model3dGenerateResult => {
  const out = data.output || data.result || data;
  const modelUrl =
    out.pbr_model ||
    out.model ||
    out.base_model ||
    out.model_url ||
    out.glb_url ||
    out.mesh_url ||
    '';
  const previewImageUrl =
    out.rendered_image || out.preview_image || out.thumbnail || out.rendered_image_url || '';
  if (!modelUrl) {
    throw new Error('任务完成但未返回模型下载地址，请检查账户额度与权限');
  }
  return {
    taskId: String(data.task_id || ''),
    modelUrl: String(modelUrl),
    previewImageUrl: previewImageUrl ? String(previewImageUrl) : undefined,
    pbrModelUrl: out.pbr_model ? String(out.pbr_model) : undefined,
    baseModelUrl: out.base_model ? String(out.base_model) : undefined,
    raw: data,
  };
};

/**
 * 真实生成 3D 模型（异步任务）。
 * high_detail → 更高面数/纹理；engine_ready → 较低面数智能减面。
 */
export const generateModel3d = async (input: Model3dGenerateInput): Promise<Model3dGenerateResult> => {
  const { apiKey } = resolveMeta();
  const quality = input.quality;

  input.onProgress?.(2, 'queued');

  if (input.mode === 'text') {
    const prompt = (input.prompt || '').trim();
    if (!prompt) throw new Error('请填写文字描述');
    const body: Record<string, unknown> = {
      type: 'text_to_model',
      prompt,
      model_version: 'v2.5-20250123',
      texture: true,
      pbr: quality === 'high_detail',
    };
    if (quality === 'engine_ready') {
      body.face_limit = 20000;
      body.smart_low_poly = true;
    } else {
      body.face_limit = 100000;
      body.texture_quality = 'detailed';
    }
    const taskId = await createTask(apiKey, body);
    input.onProgress?.(10, 'running');
    const data = await pollTask(apiKey, taskId, input.onProgress);
    return { ...pickUrls(data), taskId };
  }

  const img = (input.sourceImage || '').trim();
  if (!img) throw new Error('请上传或选用产品图');

  let fileField: Record<string, unknown>;
  if (/^https?:\/\//i.test(img)) {
    fileField = {
      type: img.toLowerCase().includes('.png') ? 'png' : 'jpeg',
      url: img,
    };
  } else {
    const { token, fileType } = await uploadImage(apiKey, img);
    input.onProgress?.(8, 'uploaded');
    fileField = { type: fileType, file_token: token };
  }

  const body: Record<string, unknown> = {
    type: 'image_to_model',
    model_version: 'v2.5-20250123',
    file: fileField,
    texture: true,
    pbr: true,
    enable_image_autofix: true,
  };
  if (input.prompt?.trim()) {
    body.prompt = input.prompt.trim();
  }
  if (quality === 'engine_ready') {
    body.face_limit = 20000;
    body.smart_low_poly = true;
    body.quad = true;
  } else {
    body.face_limit = 150000;
    body.texture_quality = 'detailed';
    body.geometry_quality = 'detailed';
  }

  const taskId = await createTask(apiKey, body);
  input.onProgress?.(12, 'running');
  const data = await pollTask(apiKey, taskId, input.onProgress);
  return { ...pickUrls(data), taskId };
};
