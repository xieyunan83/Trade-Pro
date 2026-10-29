/**
 * 千问 MaaS 通道 · Tripo 3D（异步）：提交 → 轮询 → GLB。
 * Key 来自管理后台「数据接入 · 千问通道 · Tripo 3D」。
 * 默认 Origin 与控制台 curl 一致：cn-beijing.maas.qianwenaiapi.com
 */
import {
  buildAliyunFetchHeaders,
  isLocalDevHost,
  qwenCorsHint,
} from './qwenProxy';
import {
  loadDataProvider,
  loadDataProviderLocal,
  saveDataProviderLocal,
  type DataProviderMeta,
} from './dataProviders';
import { humanizeCreativeProviderError } from './providerErrorMessage';
import { uploadLocalImageToDashscopeTemp } from './dashscopeTempUpload';
import type { Model3dGenerateInput, Model3dGenerateResult } from './model3dService';

const CREATE_PATH = '/api/v1/services/aigc/video-generation/3d-generation';
const TASK_PATH = (id: string) => `/api/v1/tasks/${encodeURIComponent(id)}`;
/** 用户截图 / curl 默认网关 */
export const DEFAULT_QWEN_TRIPO_ORIGIN = 'https://cn-beijing.maas.qianwenaiapi.com';
const DEFAULT_MODEL = 'Tripo/Tripo-H3.1';

const sanitizeKey = (k: string) =>
  (k || '')
    .replace(/^\uFEFF/, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const extractOrigin = (raw: string): string => {
  const s = (raw || '').trim();
  if (!s) return DEFAULT_QWEN_TRIPO_ORIGIN;
  try {
    if (/^https?:\/\//i.test(s)) return new URL(s).origin;
  } catch {
    /* fallthrough */
  }
  return DEFAULT_QWEN_TRIPO_ORIGIN;
};

export const getQwenTripo3dProviderStatus = (): {
  ready: boolean;
  detail: string;
  hasKey: boolean;
} => {
  const meta = loadDataProviderLocal('qwen_tripo');
  const key = sanitizeKey(meta.apiKey || '');
  if (key && meta.enabled) {
    return { ready: true, detail: '千问通道 · Tripo 3D 已就绪', hasKey: true };
  }
  if (key && !meta.enabled) {
    return {
      ready: false,
      detail: '已填写 Key，请在「数据接入」打开「千问通道 · Tripo 3D」开关',
      hasKey: true,
    };
  }
  return { ready: false, detail: '未配置千问通道 Tripo 3D Key', hasKey: false };
};

export const hydrateQwenTripo3dProvider = async () => {
  try {
    const cloud = await loadDataProvider('qwen_tripo');
    if (sanitizeKey(cloud.apiKey || '') && !cloud.enabled) {
      saveDataProviderLocal('qwen_tripo', { ...cloud, enabled: true });
    }
  } catch {
    /* local ok */
  }
  return getQwenTripo3dProviderStatus();
};

type ResolvedCfg = { apiKey: string; origin: string; modelId: string };

const resolveCfg = (): ResolvedCfg => {
  const meta = loadDataProviderLocal('qwen_tripo');
  const apiKey = sanitizeKey(meta.apiKey || '');
  if (!apiKey) {
    throw new Error(
      '未配置千问通道 Tripo API Key。请在「系统管理 → 数据接入 → 千问通道 · Tripo 3D」填写按量付费 Key。'
    );
  }
  if (!meta.enabled) {
    saveDataProviderLocal('qwen_tripo', { ...meta, enabled: true, apiKey });
  }
  const modelId = (meta.extra?.modelId || '').trim() || DEFAULT_MODEL;
  return {
    apiKey,
    origin: extractOrigin(meta.apiBase || DEFAULT_QWEN_TRIPO_ORIGIN),
    modelId,
  };
};

const buildUrl = (origin: string, path: string): { url: string; proxyOrigin: string } => {
  if (isLocalDevHost()) {
    return { url: `/qwen-api${path}`, proxyOrigin: origin };
  }
  return {
    url: `/api/qwen?__upstream=${encodeURIComponent(path)}`,
    proxyOrigin: origin || DEFAULT_QWEN_TRIPO_ORIGIN,
  };
};

const parseJson = async (res: Response): Promise<any> => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Tripo 通道返回非 JSON（HTTP ${res.status}）：${text.slice(0, 180)}`);
  }
};

const inputUsesOss = (input: Record<string, unknown>): boolean => {
  const s = JSON.stringify(input);
  return /oss:\/\//i.test(s);
};

const createTask = async (
  cfg: ResolvedCfg,
  input: Record<string, unknown>,
  parameters: Record<string, unknown>
): Promise<string> => {
  const { url, proxyOrigin } = buildUrl(cfg.origin, CREATE_PATH);
  const extra: Record<string, string> = {
    'X-DashScope-Async': 'enable',
    'X-Upstream-Path': CREATE_PATH,
  };
  if (inputUsesOss(input)) {
    extra['X-DashScope-OssResourceResolve'] = 'enable';
  }
  const headers = buildAliyunFetchHeaders({
    targetUrl: url,
    apiKey: cfg.apiKey,
    proxyOrigin: proxyOrigin || cfg.origin,
    extra,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.modelId,
        input,
        parameters,
      }),
    });
  } catch (e: any) {
    throw new Error(
      humanizeCreativeProviderError(`Tripo 任务创建失败：${e?.message || e}${qwenCorsHint(e?.message)}`)
    );
  }

  const json = await parseJson(res);
  if (!res.ok) {
    const msg =
      json.message ||
      json.code ||
      json.error?.message ||
      json.error ||
      `创建 3D 任务失败 HTTP ${res.status}`;
    throw new Error(humanizeCreativeProviderError(String(msg)));
  }
  const taskId = json.output?.task_id || json.task_id;
  if (!taskId) throw new Error('创建成功但未返回 task_id');
  return String(taskId);
};

const pollTask = async (
  cfg: ResolvedCfg,
  taskId: string,
  onProgress?: (pct: number, status: string) => void
): Promise<any> => {
  const path = TASK_PATH(taskId);
  const { url, proxyOrigin } = buildUrl(cfg.origin, path);
  const headers = buildAliyunFetchHeaders({
    targetUrl: url,
    apiKey: cfg.apiKey,
    proxyOrigin: proxyOrigin || cfg.origin,
    extra: { 'X-Upstream-Path': path },
  });

  // 官方建议：提交后约 10s 再查，之后 15～30s；3D 常需 30～120s
  await sleep(8000);
  for (let i = 0; i < 90; i++) {
    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (e: any) {
      throw new Error(`查询 Tripo 任务失败：${e?.message || e}${qwenCorsHint(e?.message)}`);
    }
    const json = await parseJson(res);
    if (!res.ok && !json.output) {
      throw new Error(json.message || `查询 Tripo 任务失败 HTTP ${res.status}`);
    }
    const out = json.output || json;
    const status = String(out.task_status || out.status || '').toUpperCase();
    const pct =
      status === 'SUCCEEDED' || status === 'SUCCESS'
        ? 100
        : status === 'RUNNING'
          ? Math.min(92, 12 + i * 1.2)
          : Math.min(22, 5 + i);
    onProgress?.(pct, status.toLowerCase() || 'running');

    if (status === 'SUCCEEDED' || status === 'SUCCESS') return out;
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
      throw new Error(
        humanizeCreativeProviderError(out.message || out.code || `3D 生成失败（${status}）`)
      );
    }
    if (status === 'UNKNOWN') {
      throw new Error('任务已过期或不可查（task_id 有效期 24 小时）');
    }
    await sleep(i < 3 ? 10000 : 18000);
  }
  throw new Error('3D 生成超时，请稍后在控制台用 task_id 查询，或检查账户额度');
};

const pickUrls = (out: any, taskId: string): Model3dGenerateResult => {
  const results = Array.isArray(out.results) ? out.results : [];
  const first = results[0] || out;
  const modelUrl =
    first.pbr_model_url ||
    first.model_url ||
    first.base_model_url ||
    out.pbr_model_url ||
    out.model_url ||
    '';
  const previewImageUrl =
    first.rendered_image_url ||
    first.generated_image_url ||
    out.rendered_image_url ||
    '';
  if (!modelUrl) {
    throw new Error('任务完成但未返回模型下载地址，请检查账户额度与模型开通状态');
  }
  return {
    taskId,
    modelUrl: String(modelUrl),
    previewImageUrl: previewImageUrl ? String(previewImageUrl) : undefined,
    pbrModelUrl: first.pbr_model_url ? String(first.pbr_model_url) : undefined,
    baseModelUrl: first.base_model_url ? String(first.base_model_url) : undefined,
    raw: out,
  };
};

/** 单次查询任务（刷新后捞回已成功的计费结果）；未完成返回 null */
export const fetchQwenTripoTaskOnce = async (
  taskId: string
): Promise<Model3dGenerateResult | null> => {
  const id = (taskId || '').trim();
  if (!id) return null;
  const cfg = resolveCfg();
  const path = TASK_PATH(id);
  const { url, proxyOrigin } = buildUrl(cfg.origin, path);
  const headers = buildAliyunFetchHeaders({
    targetUrl: url,
    apiKey: cfg.apiKey,
    proxyOrigin: proxyOrigin || cfg.origin,
    extra: { 'X-Upstream-Path': path },
  });
  const res = await fetch(url, { method: 'GET', headers });
  const json = await parseJson(res);
  if (!res.ok && !json.output) {
    throw new Error(json.message || `查询 Tripo 任务失败 HTTP ${res.status}`);
  }
  const out = json.output || json;
  const status = String(out.task_status || out.status || '').toUpperCase();
  if (status === 'SUCCEEDED' || status === 'SUCCESS') {
    return pickUrls(out, id);
  }
  if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
    throw new Error(
      humanizeCreativeProviderError(out.message || out.code || `3D 任务失败（${status}）`)
    );
  }
  return null;
};

const isPublicHttpUrl = (u: string) => /^https?:\/\//i.test(u.trim());

const guessImageType = (url: string): 'jpeg' | 'png' =>
  /\.png(\?|$)/i.test(url) ? 'png' : 'jpeg';

const buildParameters = (quality: Model3dGenerateInput['quality']): Record<string, unknown> => {
  if (quality === 'engine_ready') {
    return {
      texture_quality: 'standard',
      geometry_quality: 'standard',
      smart_low_poly: true,
      face_limit: 20000,
      pbr: true,
      texture: true,
    };
  }
  return {
    texture_quality: 'detailed',
    geometry_quality: 'ultra',
    pbr: true,
    texture: true,
  };
};

const resolveImageRefs = async (
  cfg: ResolvedCfg,
  imgs: string[],
  onProgress?: (pct: number, status: string) => void
): Promise<string[]> => {
  const out: string[] = [];
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if (isPublicHttpUrl(img) || /^oss:\/\//i.test(img)) {
      out.push(img);
      continue;
    }
    onProgress?.(4 + Math.round(((i + 0.5) / imgs.length) * 6), 'uploading');
    const ossUrl = await uploadLocalImageToDashscopeTemp({
      apiKey: cfg.apiKey,
      modelId: cfg.modelId,
      image: img,
      preferOrigin: cfg.origin,
    });
    out.push(ossUrl);
    onProgress?.(4 + Math.round(((i + 1) / imgs.length) * 6), 'uploaded');
  }
  return out;
};

/**
 * 经千问 MaaS 调用 Tripo/Tripo-H3.1（文生 / 图生 / 多视图）。
 * 本地上传图先经百炼临时存储换成 oss://，再提交异步任务。
 */
export const generateQwenTripoModel3d = async (
  input: Model3dGenerateInput
): Promise<Model3dGenerateResult> => {
  const cfg = resolveCfg();
  const parameters = buildParameters(input.quality);
  input.onProgress?.(2, 'queued');

  let taskInput: Record<string, unknown>;

  if (input.mode === 'text') {
    const prompt = (input.prompt || '').trim();
    if (!prompt) throw new Error('请填写文字描述');
    taskInput = { prompt: prompt.slice(0, 1024) };
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

    const resolved = await resolveImageRefs(cfg, imgs, input.onProgress);

    if (resolved.length >= 2) {
      const images: Record<string, unknown>[] = [{}, {}, {}, {}];
      for (let i = 0; i < Math.min(4, resolved.length); i++) {
        images[i] = {
          type: guessImageType(resolved[i]),
          file_token: resolved[i],
        };
      }
      taskInput = { images };
    } else {
      taskInput = { image: resolved[0] };
      parameters.enable_image_autofix = true;
    }
  }

  try {
    const taskId = await createTask(cfg, taskInput, parameters);
    input.onTaskCreated?.(taskId);
    input.onProgress?.(12, 'running');
    const out = await pollTask(cfg, taskId, input.onProgress);
    return pickUrls(out, taskId);
  } catch (e: any) {
    throw new Error(humanizeCreativeProviderError(e?.message || e));
  }
};

/** 供后台「保存后自启用」等场景 */
export const ensureQwenTripoMeta = (meta: DataProviderMeta, apiKey: string): DataProviderMeta => ({
  ...meta,
  enabled: true,
  apiKey: sanitizeKey(apiKey),
  apiBase: meta.apiBase?.trim() || DEFAULT_QWEN_TRIPO_ORIGIN,
  extra: {
    ...(meta.extra || {}),
    modelId: (meta.extra?.modelId || '').trim() || DEFAULT_MODEL,
  },
  updatedAt: Date.now(),
});
