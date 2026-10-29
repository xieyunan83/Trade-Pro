/**
 * 图/文生 3D：主路径 OpenAPI（上传 → 建任务 → 轮询 → GLB）；
 * 额度不足或未配置时自动回退混元 TokenHub（数据接入 · 图生 3D 备选）。
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
import { humanizeCreativeProviderError } from './providerErrorMessage';
import {
  generateHunyuanModel3d,
  getHunyuan3dProviderStatus,
  hydrateHunyuan3dProvider,
} from './hunyuan3dService';
import {
  fetchQwenTripoTaskOnce,
  generateQwenTripoModel3d,
  getQwenTripo3dProviderStatus,
  hydrateQwenTripo3dProvider,
} from './qwenTripo3dService';
import type { Model3dJob } from './creativeStudioStore';

export type Model3dGenerateInput = {
  mode: 'image' | 'text';
  prompt?: string;
  /** 单图（兼容）；多图时优先用 sourceImages */
  sourceImage?: string;
  /** 多角度参考（建议正面/侧面/背面等，最多 4 张 → 多视图建模） */
  sourceImages?: string[];
  quality: 'high_detail' | 'engine_ready';
  onProgress?: (pct: number, status: string) => void;
  /** 任务一创建就回传 task_id，刷新后可凭此捞回已扣费结果 */
  onTaskCreated?: (taskId: string) => void;
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
  const hunyuan = getHunyuan3dProviderStatus();
  const qwenTripo = getQwenTripo3dProviderStatus();

  if (qwenTripo.ready || (hasKey && enabled) || hunyuan.ready) {
    return {
      ready: true,
      detail: qwenTripo.ready
        ? '3D 服务已就绪'
        : hunyuan.ready && !(hasKey && enabled)
          ? '3D 备选服务已就绪'
          : '3D 服务已就绪',
      hasKey: qwenTripo.hasKey || hasKey || hunyuan.hasKey,
      enabled: true,
    };
  }
  if (qwenTripo.hasKey && !qwenTripo.ready) {
    return {
      ready: false,
      detail: qwenTripo.detail,
      hasKey: true,
      enabled: false,
    };
  }
  if (hasKey && !meta.enabled) {
    return {
      ready: false,
      detail: '已填写 Key，请在「数据接入」打开「图生 3D」相关开关（或配置千问通道 / 备选 Key）',
      hasKey,
      enabled: false,
    };
  }
  if (hunyuan.hasKey && !hunyuan.ready) {
    return {
      ready: false,
      detail: hunyuan.detail,
      hasKey: true,
      enabled: false,
    };
  }
  return {
    ready: false,
    detail: '请先配置图生 3D API Key（系统管理 → 数据接入 · 千问通道 Tripo，或本页管理员快捷配置）',
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
  await hydrateQwenTripo3dProvider();
  await hydrateHunyuan3dProvider();
  return getModel3dProviderStatus();
};

const isTripoReady = (): boolean => {
  const meta = loadDataProviderLocal('tripo');
  const key = pickKey(meta);
  return !!(key && (meta.enabled || sanitizeKey(env.tripoApiKey || '')));
};

const isCreditOrQuotaError = (msg: string): boolean =>
  /credit|余额|额度|quota|insufficient|payment|欠费|充值|balance|no funds|not enough/i.test(msg);

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
  throw new Error(humanizeCreativeProviderError(String(msg)));
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
      throw new Error(
        humanizeCreativeProviderError(data.error_msg || data.message || `3D 生成失败（${status}）`)
      );
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
 * 优先：千问 MaaS · Tripo → 混元备选 → Tripo 官方直连；额度/鉴权失败时互备回退。
 */
export const generateModel3d = async (input: Model3dGenerateInput): Promise<Model3dGenerateResult> => {
  const qwenOk = getQwenTripo3dProviderStatus().ready;
  const tripoOk = isTripoReady();
  const hunyuanOk = getHunyuan3dProviderStatus().ready;

  if (!qwenOk && !tripoOk && !hunyuanOk) {
    throw new Error(
      humanizeCreativeProviderError(
        '未配置图生 3D API。请在「数据接入」填写「千问通道 · Tripo 3D」或其它 3D Key，或使用本页管理员快捷配置。'
      )
    );
  }

  const order: Array<'qwen_tripo' | 'hunyuan' | 'tripo'> = [];
  if (qwenOk) order.push('qwen_tripo');
  if (hunyuanOk) order.push('hunyuan');
  if (tripoOk) order.push('tripo');

  let lastErr: Error | null = null;
  for (let i = 0; i < order.length; i++) {
    const provider = order[i];
    try {
      if (provider === 'qwen_tripo') {
        return await generateQwenTripoModel3d(input);
      }
      if (provider === 'hunyuan') {
        return await generateHunyuanModel3d(input);
      }
      return await generateModel3dInner(input);
    } catch (e: any) {
      const msg = String(e?.message || e);
      lastErr = new Error(humanizeCreativeProviderError(msg));
      const canFallback =
        i < order.length - 1 &&
        (isCreditOrQuotaError(msg) ||
          /未配置|Key|401|403|额度|公网图片|公网 URL|InvalidApiKey|不支持/i.test(msg));
      if (canFallback) {
        input.onProgress?.(3, 'fallback');
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr || new Error('3D 生成失败');
};

const generateModel3dInner = async (input: Model3dGenerateInput): Promise<Model3dGenerateResult> => {
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
    input.onTaskCreated?.(taskId);
    input.onProgress?.(10, 'running');
    const data = await pollTask(apiKey, taskId, input.onProgress);
    return { ...pickUrls(data), taskId };
  }

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

  const toFileField = async (img: string): Promise<Record<string, unknown>> => {
    if (/^https?:\/\//i.test(img)) {
      return {
        type: img.toLowerCase().includes('.png') ? 'png' : 'jpeg',
        url: img,
      };
    }
    const { token, fileType } = await uploadImage(apiKey, img);
    return { type: fileType, file_token: token };
  };

  const qualityBits =
    quality === 'engine_ready'
      ? { face_limit: 20000, smart_low_poly: true, quad: true }
      : { face_limit: 150000, texture_quality: 'detailed', geometry_quality: 'detailed' };

  // ≥2 张：多视图建模（files 固定 4 槽：front / left / back / right）
  if (imgs.length >= 2) {
    input.onProgress?.(5, 'uploading');
    const uploaded: Record<string, unknown>[] = [];
    for (let i = 0; i < imgs.length; i++) {
      uploaded.push(await toFileField(imgs[i]));
      input.onProgress?.(5 + Math.round(((i + 1) / imgs.length) * 8), 'uploaded');
    }
    // 按选用顺序填槽；不足 4 张用空对象占位（首张必须为正面）
    const files: Record<string, unknown>[] = [{}, {}, {}, {}];
    for (let i = 0; i < 4; i++) {
      files[i] = uploaded[i] || {};
    }
    const body: Record<string, unknown> = {
      type: 'multiview_to_model',
      model_version: 'v2.5-20250123',
      files,
      texture: true,
      pbr: true,
      ...qualityBits,
    };
    if (input.prompt?.trim()) body.prompt = input.prompt.trim();
    const taskId = await createTask(apiKey, body);
    input.onTaskCreated?.(taskId);
    input.onProgress?.(14, 'running');
    const data = await pollTask(apiKey, taskId, input.onProgress);
    return { ...pickUrls(data), taskId };
  }

  const fileField = await toFileField(imgs[0]);
  input.onProgress?.(8, 'uploaded');

  const body: Record<string, unknown> = {
    type: 'image_to_model',
    model_version: 'v2.5-20250123',
    file: fileField,
    texture: true,
    pbr: true,
    enable_image_autofix: true,
    ...qualityBits,
  };
  if (input.prompt?.trim()) {
    body.prompt = input.prompt.trim();
  }

  const taskId = await createTask(apiKey, body);
  input.onTaskCreated?.(taskId);
  input.onProgress?.(12, 'running');
  const data = await pollTask(apiKey, taskId, input.onProgress);
  return { ...pickUrls(data), taskId };
};

const jobHasModel = (j: Model3dJob) =>
  !!(j.modelUrl || j.pbrModelUrl || j.baseModelUrl);

/** 同步清理：刷新后仍卡在 running@100% 的僵尸任务 */
export const sanitizeModel3dJobs = (jobs: Model3dJob[]): Model3dJob[] => {
  const now = Date.now();
  return jobs.map((j) => {
    if (j.status === 'failed') return j;
    if (jobHasModel(j)) {
      if (j.status === 'ready') return j;
      return {
        ...j,
        status: 'ready',
        progress: 100,
        previewHint: j.previewHint || '模型已就绪 · 可拖动环视',
        error: undefined,
        updatedAt: now,
      };
    }
    if (j.status !== 'running' && j.status !== 'queued') return j;
    const stale =
      (j.progress ?? 0) >= 98 || now - (j.updatedAt || j.createdAt) > 2 * 60 * 1000;
    if (!stale) return j;
    return {
      ...j,
      status: 'failed',
      progress: 0,
      error:
        '上次生成在浏览器刷新或本机落库时中断。云端可能已扣费；若任务仍卡在「准备预览」，请删除本条后重新生成。',
      previewHint: '生成中断 · 请删除后重试',
      updatedAt: now,
    };
  });
};

/** 有 task_id 时尝试从云端捞回已成功的 GLB（不重复计费查询） */
export const recoverModel3dJobs = async (jobs: Model3dJob[]): Promise<Model3dJob[]> => {
  const base = sanitizeModel3dJobs(jobs);
  const out: Model3dJob[] = [];
  for (const j of base) {
    if (j.status === 'ready' || j.status === 'failed' || !j.providerTaskId || jobHasModel(j)) {
      out.push(j);
      continue;
    }
    if (!getQwenTripo3dProviderStatus().ready) {
      out.push(j);
      continue;
    }
    try {
      const result = await fetchQwenTripoTaskOnce(j.providerTaskId);
      if (result?.modelUrl) {
        out.push({
          ...j,
          status: 'ready',
          progress: 100,
          modelUrl: result.modelUrl,
          pbrModelUrl: result.pbrModelUrl || j.pbrModelUrl,
          baseModelUrl: result.baseModelUrl || j.baseModelUrl,
          previewImageUrl: result.previewImageUrl || j.previewImageUrl,
          previewHint: '模型已就绪 · 已从云端恢复',
          error: undefined,
          updatedAt: Date.now(),
        });
        continue;
      }
    } catch (e) {
      console.warn('[model3d] recover task failed', j.providerTaskId, e);
    }
    out.push(
      sanitizeModel3dJobs([
        {
          ...j,
          progress: 100,
          updatedAt: Date.now() - 3 * 60 * 1000,
        },
      ])[0]
    );
  }
  return out;
};
