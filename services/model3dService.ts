/**
 * 图/文生 3D：主路径千问 MaaS Tripo（上传 → 建任务 → 轮询 → GLB）；
 * 额度不足或未配置时回退混元；官方 tsk_ 仅作显式配置时的垫底，默认不走。
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
  runQwenTripoPostProcess,
} from './qwenTripo3dService';
import type { Model3dJob } from './creativeStudioStore';

/** 贴图质量（千问 MaaS Tripo parameters.texture_quality） */
export type Model3dTextureQuality = 'standard' | 'detailed' | 'extreme';

export type Model3dGenerateInput = {
  mode: 'image' | 'text';
  prompt?: string;
  /** 反向提示（写入 parameters.negative_prompt，勿塞进 prompt） */
  negativePrompt?: string;
  /** 单图（兼容）；多图时优先用 sourceImages */
  sourceImage?: string;
  /** 多角度参考（建议正面/侧面/背面等，最多 4 张 → 多视图建模） */
  sourceImages?: string[];
  quality: 'high_detail' | 'engine_ready';
  /** 贴图档；缺省：高细节→detailed，引擎就绪→standard */
  textureQuality?: Model3dTextureQuality;
  /** 图生：模型朝向对齐参考图 */
  alignImage?: boolean;
  /** 自动缩放到真实世界尺寸（米） */
  autoSize?: boolean;
  /** 面数上限（引擎就绪默认 20000） */
  faceLimit?: number;
  onProgress?: (pct: number, status: string) => void;
  /** 任务一创建就回传 task_id，刷新后可凭此捞回已扣费结果 */
  onTaskCreated?: (taskId: string) => void;
};

export type Model3dGenerateResult = {
  taskId: string;
  /** 后处理链的根任务（首次生成） */
  sourceTaskId?: string;
  modelUrl: string;
  previewImageUrl?: string;
  pbrModelUrl?: string;
  baseModelUrl?: string;
  /** 网格分割返回的部件名（Tripo / 千问 Segmentation） */
  partNames?: string[];
  provider?: 'tripo' | 'qwen_tripo' | 'hunyuan';
  modelVersion?: string;
  raw?: unknown;
};

/** 与 Tripo 官方对齐的模型版本 */
export const TRIPO_MODEL_H = 'v3.1-20260211';
export const TRIPO_MODEL_H_STABLE = 'v3.0-20250812';
export const TRIPO_MODEL_P = 'P1-20260311';
export const TRIPO_TEXTURE_MODEL = 'v3.0-20250812';

export type TripoPostProcessKind =
  | 'texture_hd'
  | 'lowpoly'
  | 'retopo'
  | 'segment'
  | 'complete'
  | 'rig'
  | 'convert';
export type TripoConvertFormat = 'GLTF' | 'USDZ' | 'FBX' | 'OBJ' | 'STL' | '3MF';
export type TripoSegmentGranularity = 'simple' | 'balanced' | 'detailed';
export type TripoRigType = 'biped' | 'quadruped' | 'hexapod' | 'octopod' | 'serpentine' | 'aquatic';

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
      detail: '已填写 Key，请在「数据接入」打开「图生 3D」相关开关（或配置主通道 / 备选 Key）',
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
    detail: '请先配置图生 3D API Key（系统管理 → 数据接入 · 图生 3D，或本页管理员快捷配置）',
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

/** UI：是否可走官方 tsk_ 后处理 */
export const isTripoOfficialReady = (): boolean => isTripoReady();

/** UI：制造编辑是否可用（千问主通道 sk- 或官方 tsk_ 任一即可） */
export const isModel3dEditReady = (): boolean =>
  getQwenTripo3dProviderStatus().ready || isTripoReady();

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
  const results = Array.isArray(out.results) ? out.results : [];
  const first = results[0] || out;
  // 分割结果优先 seg_model；禁止未分割 pbr 盖住分件
  const modelUrl =
    first.seg_model_url ||
    first.seg_model ||
    out.seg_model_url ||
    out.seg_model ||
    first.model_url ||
    out.model_url ||
    first.model ||
    out.model ||
    out.pbr_model ||
    out.base_model ||
    out.glb_url ||
    out.mesh_url ||
    out.fbx_url ||
    out.obj_url ||
    out.stl_url ||
    out.usdz_url ||
    out.gltf_url ||
    '';
  const previewImageUrl =
    first.rendered_image_url ||
    out.rendered_image ||
    out.preview_image ||
    out.thumbnail ||
    out.rendered_image_url ||
    '';
  if (!modelUrl) {
    throw new Error('任务完成但未返回模型下载地址，请检查账户额度与权限');
  }
  const partRaw = first.part_names || out.part_names || first.partNames || out.partNames;
  const partNames = Array.isArray(partRaw)
    ? partRaw.map((x: unknown) => String(x || '').trim()).filter(Boolean)
    : typeof partRaw === 'string' && partRaw.trim()
      ? partRaw
          .split(/[,，;；|/]+/)
          .map((s: string) => s.trim())
          .filter(Boolean)
      : undefined;
  return {
    taskId: String(data.task_id || first.task_id || ''),
    modelUrl: String(modelUrl),
    previewImageUrl: previewImageUrl ? String(previewImageUrl) : undefined,
    pbrModelUrl: out.pbr_model || first.pbr_model_url
      ? String(out.pbr_model || first.pbr_model_url)
      : undefined,
    baseModelUrl: out.base_model || first.base_model_url
      ? String(out.base_model || first.base_model_url)
      : undefined,
    partNames,
    raw: data,
  };
};

/**
 * 真实生成 3D 模型（异步任务）。
 * high_detail → H3.1 超清几何 + 可选贴图档；engine_ready → 同模型智能低模。
 * 优先：千问 MaaS Tripo → 混元备选 →（仅显式配置 tsk_ 时）官方垫底。
 */
export const generateModel3d = async (input: Model3dGenerateInput): Promise<Model3dGenerateResult> => {
  const qwenOk = getQwenTripo3dProviderStatus().ready;
  const tripoOk = isTripoReady();
  const hunyuanOk = getHunyuan3dProviderStatus().ready;

  if (!qwenOk && !tripoOk && !hunyuanOk) {
    throw new Error(
      humanizeCreativeProviderError(
        '未配置图生 3D API。请在「数据接入」填写图生 3D Key，或使用本页管理员快捷配置。'
      )
    );
  }

  // 主路径：千问 MaaS Tripo（与官方 H3.1/P1 同参能力）；无官方 Key 时直连会失败
  const order: Array<'tripo' | 'qwen_tripo' | 'hunyuan'> = [];
  if (qwenOk) order.push('qwen_tripo');
  if (hunyuanOk) order.push('hunyuan');
  if (tripoOk) order.push('tripo');

  let lastErr: Error | null = null;
  for (let i = 0; i < order.length; i++) {
    const provider = order[i];
    try {
      if (provider === 'tripo') {
        return await generateModel3dInner(input);
      }
      if (provider === 'qwen_tripo') {
        const r = await generateQwenTripoModel3d(input);
        return { ...r, provider: 'qwen_tripo', sourceTaskId: r.taskId };
      }
      const r = await generateHunyuanModel3d(input);
      return { ...r, provider: 'hunyuan', sourceTaskId: r.taskId };
    } catch (e: any) {
      const msg = String(e?.message || e);
      lastErr = new Error(humanizeCreativeProviderError(msg));
      const canFallback =
        i < order.length - 1 &&
        (isCreditOrQuotaError(msg) ||
          /未配置|Key|401|403|额度|公网图片|公网 URL|InvalidApiKey|不支持|model_version|1004/i.test(msg));
      if (canFallback) {
        input.onProgress?.(3, 'fallback');
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr || new Error('3D 生成失败');
};

/** Tripo 高细节 / 引擎向参数（对齐官方 H 系列 / P 系列） */
const tripoQualityParams = (
  quality: Model3dGenerateInput['quality'],
  kind: 'text' | 'image' | 'multiview'
): { modelVersion: string; bits: Record<string, unknown> } => {
  if (quality === 'engine_ready') {
    // P 系列：干净低面拓扑，适合引擎 / 打印预备
    if (kind !== 'text') {
      return {
        modelVersion: TRIPO_MODEL_P,
        bits: {
          texture: true,
          pbr: true,
          face_limit: 8000,
          texture_quality: 'standard',
        },
      };
    }
    return {
      modelVersion: TRIPO_MODEL_H,
      bits: {
        texture: true,
        pbr: true,
        face_limit: 20000,
        smart_low_poly: true,
        texture_quality: 'standard',
        geometry_quality: 'standard',
        export_uv: true,
      },
    };
  }
  return {
    modelVersion: TRIPO_MODEL_H,
    bits: {
      texture: true,
      pbr: true,
      texture_quality: 'detailed',
      geometry_quality: 'detailed',
      enable_image_autofix: kind !== 'text',
      export_uv: true,
    },
  };
};

const generateModel3dInner = async (input: Model3dGenerateInput): Promise<Model3dGenerateResult> => {
  const { apiKey } = resolveMeta();
  const quality = input.quality;

  input.onProgress?.(2, 'queued');

  if (input.mode === 'text') {
    const prompt = (input.prompt || '').trim();
    if (!prompt) throw new Error('请填写文字描述');
    const { modelVersion, bits } = tripoQualityParams(quality, 'text');
    const body: Record<string, unknown> = {
      type: 'text_to_model',
      prompt: prompt.slice(0, 1024),
      model_version: modelVersion,
      ...bits,
    };
    const taskId = await createTask(apiKey, body);
    input.onTaskCreated?.(taskId);
    input.onProgress?.(10, 'running');
    const data = await pollTask(apiKey, taskId, input.onProgress);
    return {
      ...pickUrls(data),
      taskId,
      sourceTaskId: taskId,
      provider: 'tripo',
      modelVersion,
    };
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
        type: img.toLowerCase().includes('.png')
          ? 'png'
          : img.toLowerCase().includes('.webp')
            ? 'webp'
            : 'jpeg',
        url: img,
      };
    }
    const { token, fileType } = await uploadImage(apiKey, img);
    return { type: fileType, file_token: token };
  };

  // ≥2 张：多视图建模（files 固定 4 槽：front / left / back / right；首张=正面，不可空）
  if (imgs.length >= 2) {
    const { modelVersion, bits } = tripoQualityParams(quality, 'multiview');
    input.onProgress?.(5, 'uploading');
    const uploaded: Record<string, unknown>[] = [];
    for (let i = 0; i < imgs.length; i++) {
      uploaded.push(await toFileField(imgs[i]));
      input.onProgress?.(5 + Math.round(((i + 1) / imgs.length) * 8), 'uploaded');
    }
    const files: Record<string, unknown>[] = [{}, {}, {}, {}];
    for (let i = 0; i < 4; i++) {
      files[i] = uploaded[i] || {};
    }
    const body: Record<string, unknown> = {
      type: 'multiview_to_model',
      model_version: modelVersion,
      files,
      ...bits,
    };
    if (input.prompt?.trim()) body.prompt = input.prompt.trim().slice(0, 1024);
    const taskId = await createTask(apiKey, body);
    input.onTaskCreated?.(taskId);
    input.onProgress?.(14, 'running');
    const data = await pollTask(apiKey, taskId, input.onProgress);
    return {
      ...pickUrls(data),
      taskId,
      sourceTaskId: taskId,
      provider: 'tripo',
      modelVersion,
    };
  }

  const { modelVersion, bits } = tripoQualityParams(quality, 'image');
  const fileField = await toFileField(imgs[0]);
  input.onProgress?.(8, 'uploaded');

  const body: Record<string, unknown> = {
    type: 'image_to_model',
    model_version: modelVersion,
    file: fileField,
    ...bits,
  };
  if (input.prompt?.trim()) {
    body.prompt = input.prompt.trim().slice(0, 1024);
  }

  const taskId = await createTask(apiKey, body);
  input.onTaskCreated?.(taskId);
  input.onProgress?.(12, 'running');
  const data = await pollTask(apiKey, taskId, input.onProgress);
  return {
    ...pickUrls(data),
    taskId,
    sourceTaskId: taskId,
    provider: 'tripo',
    modelVersion,
  };
};

/** 从本机 vault / blob / https 拉成 Blob，供上传到官方编辑通道 */
const resolveModelBlob = async (
  modelUrl: string
): Promise<{ blob: Blob; filename: string; ext: string }> => {
  const raw = (modelUrl || '').trim();
  if (!raw) throw new Error('缺少模型文件地址');

  let blob: Blob;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('blob:')) {
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`读取模型失败 HTTP ${res.status}`);
    blob = await res.blob();
  } else if (raw.startsWith('vault:')) {
    const { resolveMediaUrl } = await import('./creativeAssetVault');
    const resolved = await resolveMediaUrl(raw);
    if (!resolved) throw new Error('本机素材库中找不到该模型，请重新生成或导入');
    const res = await fetch(resolved);
    if (!res.ok) throw new Error('读取本机模型失败');
    blob = await res.blob();
  } else if (raw.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.+)$/i.exec(raw);
    if (!m) throw new Error('模型 data URL 无效');
    const bin = atob(m[2]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    blob = new Blob([arr], { type: m[1] || 'model/gltf-binary' });
  } else {
    throw new Error('不支持的模型地址格式，请使用 GLB 下载链或本机导入');
  }

  if (blob.size > 148 * 1024 * 1024) {
    throw new Error('模型超过 150MB，无法上传做后处理，请先减面');
  }
  const lower = raw.toLowerCase();
  const ext = lower.includes('.stl')
    ? 'stl'
    : lower.includes('.obj')
      ? 'obj'
      : lower.includes('.fbx')
        ? 'fbx'
        : lower.includes('.gltf')
          ? 'gltf'
          : 'glb';
  return { blob, filename: `model.${ext}`, ext };
};

/** 上传 3D 文件到官方通道，返回 file_token */
const uploadModelFile = async (
  apiKey: string,
  modelUrl: string
): Promise<{ fileToken: string; fileType: string }> => {
  const { blob, filename, ext } = await resolveModelBlob(modelUrl);
  const tryUpload = async (path: string) => {
    const form = new FormData();
    form.append('file', blob, filename);
    const res = await fetch(tripoUrl(path), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const json = await parseJson(res);
    throwIfApiError(res, json, `模型上传失败 HTTP ${res.status}`);
    const token =
      json.data?.file_token ||
      json.data?.image_token ||
      json.file_token ||
      json.image_token ||
      json.data?.resource_uri ||
      '';
    if (!token) throw new Error('模型上传成功但未返回 file_token');
    return String(token);
  };

  let fileToken: string;
  try {
    fileToken = await tryUpload('/v2/openapi/upload/sts');
  } catch (e1: any) {
    try {
      fileToken = await tryUpload('/v2/openapi/upload');
    } catch {
      throw new Error(e1?.message || '模型上传失败');
    }
  }
  return { fileToken, fileType: ext };
};

/**
 * 将千问/混元/本地 GLB 导入官方编辑通道，得到可用于拆分/重拓扑等的 task_id。
 * 已有官方任务则直接返回。
 */
export const ensureOfficialModelTaskId = async (opts: {
  provider?: string;
  providerTaskId?: string;
  officialTaskId?: string;
  modelUrl?: string;
  onProgress?: (pct: number, status: string) => void;
}): Promise<string> => {
  if (!isTripoReady()) {
    throw new Error(
      '制造级后处理（部件拆分 / 重拓扑 / 导出 STL 等）需配置官方 3D 编辑通道 Key（tsk_ 开头）。生成可用主通道，编辑请另配编辑 Key。'
    );
  }
  const existing = (opts.officialTaskId || '').trim();
  if (existing) return existing;

  const provider = (opts.provider || '').trim();
  const tid = (opts.providerTaskId || '').trim();
  // 官方通道生成的任务可直接串联
  if (provider === 'tripo' && tid) return tid;

  const modelUrl = (opts.modelUrl || '').trim();
  if (!modelUrl) {
    throw new Error('缺少模型文件，无法导入编辑通道。请先生成或导入 GLB。');
  }

  const { apiKey } = resolveMeta();
  opts.onProgress?.(5, 'importing');

  let file: Record<string, unknown>;
  if (/^https?:\/\//i.test(modelUrl) && !/localhost|127\.0\.0\.1/i.test(modelUrl)) {
    const lower = modelUrl.toLowerCase();
    const type = lower.includes('.stl')
      ? 'stl'
      : lower.includes('.obj')
        ? 'obj'
        : lower.includes('.fbx')
          ? 'fbx'
          : 'glb';
    file = { type, url: modelUrl };
  } else {
    const up = await uploadModelFile(apiKey, modelUrl);
    file = { type: up.fileType, file_token: up.fileToken };
  }

  opts.onProgress?.(12, 'import_queued');
  const importId = await createTask(apiKey, { type: 'import_model', file });
  opts.onProgress?.(20, 'import_running');
  await pollTask(apiKey, importId, opts.onProgress);
  return importId;
};

const postProcessLabel = (kind: TripoPostProcessKind, format?: TripoConvertFormat): string => {
  switch (kind) {
    case 'segment':
      return '部件拆分';
    case 'complete':
      return '部件补全';
    case 'lowpoly':
    case 'retopo':
      return '重拓扑';
    case 'texture_hd':
      return '高清贴图';
    case 'rig':
      return '自动绑定';
    case 'convert':
      return `导出 ${format || 'OBJ'}`;
    default:
      return '后处理';
  }
};

/**
 * 官方 tsk_ 编辑通道后处理（垫底；优先走千问 sk-）
 */
const runOfficialTripoPostProcess = async (opts: {
  kind: TripoPostProcessKind;
  originalTaskId: string;
  format?: TripoConvertFormat;
  texturePrompt?: string;
  faceLimit?: number;
  quad?: boolean;
  segmentGranularity?: TripoSegmentGranularity;
  rigType?: TripoRigType;
  rigSpec?: 'tripo' | 'mixamo';
  onProgress?: (pct: number, status: string) => void;
  onTaskCreated?: (taskId: string) => void;
}): Promise<Model3dGenerateResult & { label: string }> => {
  if (!isTripoReady()) {
    throw new Error(
      '当前未配置 3D 编辑能力。请确认主通道 Key 已启用，或另配官方编辑通道。'
    );
  }
  const { apiKey } = resolveMeta();
  const original = (opts.originalTaskId || '').trim();
  if (!original) throw new Error('缺少上游任务 ID，无法后处理');

  const kind = opts.kind === 'lowpoly' ? 'retopo' : opts.kind;
  let body: Record<string, unknown>;

  if (kind === 'texture_hd') {
    body = {
      type: 'texture_model',
      original_model_task_id: original,
      model_version: TRIPO_TEXTURE_MODEL,
      texture: true,
      pbr: true,
      texture_quality: 'detailed',
      bake: true,
      texture_alignment: 'original_image',
    };
    if (opts.texturePrompt?.trim()) {
      body.texture_prompt = { text: opts.texturePrompt.trim().slice(0, 1024) };
    }
  } else if (kind === 'retopo') {
    const faceLimit =
      opts.faceLimit && opts.faceLimit > 0
        ? Math.min(100_000, Math.max(500, Math.round(opts.faceLimit)))
        : 8000;
    body = {
      type: 'highpoly_to_lowpoly',
      original_model_task_id: original,
      model_version: 'P-v2.0-20251225',
      quad: opts.quad !== false,
      face_limit: faceLimit,
      bake: true,
    };
  } else if (kind === 'segment') {
    // 与千问通道对齐：v2 + 粒度 + 连通域，避免官方垫底永远粗拆成 1 块
    body = {
      type: 'mesh_segmentation',
      original_model_task_id: original,
      model_version: 'v2.0-20260430',
      segmentation_granularity: opts.segmentGranularity || 'balanced',
      split_by_connectivity: true,
    };
  } else if (kind === 'complete') {
    body = {
      type: 'mesh_completion',
      original_model_task_id: original,
      model_version: 'v1.0-20250506',
    };
  } else if (kind === 'rig') {
    body = {
      type: 'animate_rig',
      original_model_task_id: original,
      model_version: 'v2.5-20260210',
      out_format: 'glb',
      rig_type: opts.rigType || 'biped',
      spec: opts.rigSpec || 'tripo',
    };
  } else {
    const format = opts.format || 'STL';
    body = {
      type: 'convert_model',
      original_model_task_id: original,
      format,
      face_limit: opts.faceLimit && opts.faceLimit > 0 ? opts.faceLimit : 10000,
      bake: true,
      pivot_to_center_bottom: true,
      flatten_bottom: format === 'STL' || format === 'OBJ' || format === '3MF',
    };
  }

  opts.onProgress?.(8, 'queued');
  const taskId = await createTask(apiKey, body);
  opts.onTaskCreated?.(taskId);
  opts.onProgress?.(15, 'running');
  const data = await pollTask(apiKey, taskId, opts.onProgress);
  const picked = pickUrls(data);
  return {
    ...picked,
    taskId,
    sourceTaskId: original,
    provider: 'tripo',
    label: postProcessLabel(opts.kind, opts.format),
  };
};

/**
 * 制造后处理：优先千问主通道（与生成同一条 Key），官方 tsk_ 作垫底。
 */
export const runTripoPostProcess = async (opts: {
  kind: TripoPostProcessKind;
  /** 最近一次成功任务；贴图/减面/转换均基于此 */
  originalTaskId?: string;
  /** 公网模型 URL（千问通道在无 task_id 时可用） */
  modelUrl?: string;
  /** 拆分时优先 model_url（治愈脏 task_id） */
  preferModelUrl?: boolean;
  format?: TripoConvertFormat;
  texturePrompt?: string;
  faceLimit?: number;
  /** 重拓扑：四边面（模具/细分友好）或三角面 */
  quad?: boolean;
  /** 部件拆分粒度 */
  segmentGranularity?: TripoSegmentGranularity;
  rigType?: TripoRigType;
  rigSpec?: 'tripo' | 'mixamo';
  /** 优先强制官方通道（一般不用） */
  preferOfficial?: boolean;
  onProgress?: (pct: number, status: string) => void;
  onTaskCreated?: (taskId: string) => void;
}): Promise<Model3dGenerateResult & { label: string }> => {
  const qwenOk = getQwenTripo3dProviderStatus().ready;
  const officialOk = isTripoReady();

  if (!opts.preferOfficial && qwenOk) {
    try {
      return await runQwenTripoPostProcess({
        kind: opts.kind,
        originalTaskId: opts.originalTaskId,
        modelUrl: opts.modelUrl,
        preferModelUrl: opts.preferModelUrl,
        format: opts.format,
        texturePrompt: opts.texturePrompt,
        faceLimit: opts.faceLimit,
        quad: opts.quad,
        segmentGranularity: opts.segmentGranularity,
        rigType: opts.rigType,
        onProgress: opts.onProgress,
        onTaskCreated: opts.onTaskCreated,
      });
    } catch (e: any) {
      // 千问未开通某后处理模型时，有官方 Key 再垫底
      if (!officialOk) throw e;
      console.warn('[model3d] qwen post-process failed, fallback official', e?.message || e);
    }
  }

  if (!officialOk) {
    throw new Error(
      '无法执行部件拆分 / 重拓扑 / 制造导出。请确认已启用 3D 主通道 Key，并在控制台开通对应后处理能力。'
    );
  }
  const original = (opts.originalTaskId || '').trim();
  if (!original) {
    throw new Error('缺少上游任务 ID，无法后处理');
  }
  return runOfficialTripoPostProcess({
    ...opts,
    originalTaskId: original,
  });
};

/** 单次查询 Tripo 官方任务（用于刷新恢复） */
export const fetchTripoTaskOnce = async (taskId: string): Promise<Model3dGenerateResult | null> => {
  if (!isTripoReady() || !taskId.trim()) return null;
  const { apiKey } = resolveMeta();
  const res = await fetch(tripoUrl(`/v2/openapi/task/${encodeURIComponent(taskId.trim())}`), {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const json = await parseJson(res);
  if (!res.ok || (json.code != null && json.code !== 0 && !json.data)) return null;
  const data = json.data || json;
  const status = String(data.status || '').toLowerCase();
  if (!(status === 'success' || status === 'succeeded' || status === 'completed')) return null;
  try {
    return { ...pickUrls(data), taskId: String(data.task_id || taskId), provider: 'tripo' };
  } catch {
    return null;
  }
};

const jobHasModel = (j: Model3dJob) =>
  !!(j.modelUrl || j.pbrModelUrl || j.baseModelUrl || j.cloudModelUrl || j.originalModelUrl);

const pickHttps = (...urls: Array<string | undefined>) => {
  for (const u of urls) {
    const s = (u || '').trim();
    if (s && /^https?:\/\//i.test(s)) return s;
  }
  return undefined;
};

/** 本机 vault 引用是否还有真实 Blob（清空素材后常见「ready 但文件已空」） */
const vaultBlobAlive = async (u?: string): Promise<boolean> => {
  const s = (u || '').trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s) || s.startsWith('blob:') || s.startsWith('data:')) return true;
  try {
    const { isVaultRef, resolveMediaBlob } = await import('./creativeAssetVault');
    if (!isVaultRef(s)) return !!s;
    const blob = await resolveMediaBlob(s);
    return !!(blob && blob.size > 64);
  } catch {
    return false;
  }
};

const jobLocalMeshAlive = async (j: Model3dJob): Promise<boolean> => {
  for (const u of [j.modelUrl, j.pbrModelUrl, j.baseModelUrl, j.originalModelUrl]) {
    if (await vaultBlobAlive(u)) return true;
  }
  return false;
};

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

const fetchCloudResultForJob = async (
  j: Model3dJob
): Promise<Model3dGenerateResult | null> => {
  if (!j.providerTaskId) return null;
  let result: Model3dGenerateResult | null = null;
  const preferOfficial = j.provider === 'tripo' && isTripoReady();
  const preferQwen =
    (j.provider === 'qwen_tripo' || !preferOfficial) && getQwenTripo3dProviderStatus().ready;
  if (preferQwen) {
    try {
      result = await fetchQwenTripoTaskOnce(j.providerTaskId);
    } catch (e) {
      console.warn('[model3d] qwen recover failed', j.providerTaskId, e);
    }
  }
  if (!result?.modelUrl && isTripoReady()) {
    try {
      result = await fetchTripoTaskOnce(j.providerTaskId);
    } catch (e) {
      console.warn('[model3d] tripo recover failed', j.providerTaskId, e);
    }
  }
  return result;
};

/**
 * 恢复已扣费但本机丢失的 GLB：
 * 1) ready 但 vault 空 → 用 cloud*Url / task_id 再拉
 * 2) running/queued 无地址 → 用 task_id 查结果（不重复计费）
 */
export const recoverModel3dJobs = async (jobs: Model3dJob[]): Promise<Model3dJob[]> => {
  const base = sanitizeModel3dJobs(jobs);
  const out: Model3dJob[] = [];
  for (const j of base) {
    if (j.status === 'failed') {
      out.push(j);
      continue;
    }

    const alive = await jobLocalMeshAlive(j);
    if (alive && j.status === 'ready') {
      out.push(j);
      continue;
    }

    // 本机空了：优先用备份的 https 链（仍有效时零请求 task）
    const cloudHttps = pickHttps(
      j.cloudModelUrl,
      j.cloudPbrModelUrl,
      j.cloudBaseModelUrl,
      j.modelUrl,
      j.pbrModelUrl,
      j.baseModelUrl,
      j.originalModelUrl
    );
    if (!alive && cloudHttps) {
      out.push({
        ...j,
        status: 'ready',
        progress: 100,
        modelUrl: cloudHttps,
        pbrModelUrl: j.pbrModelUrl || cloudHttps,
        cloudModelUrl: j.cloudModelUrl || cloudHttps,
        previewHint: '模型已就绪 · 已从备份链恢复，正在写入本机',
        error: undefined,
        updatedAt: Date.now(),
      });
      continue;
    }

    if (!j.providerTaskId) {
      out.push(j);
      continue;
    }

    // ready 空文件 / 未完成任务：用 task_id 查云端结果（不重新生成、不重复计费）
    if (j.status === 'ready' || j.status === 'running' || j.status === 'queued' || !alive) {
      const result = await fetchCloudResultForJob(j);
      if (result?.modelUrl) {
        out.push({
          ...j,
          status: 'ready',
          progress: 100,
          provider: result.provider || j.provider,
          modelUrl: result.modelUrl,
          pbrModelUrl: result.pbrModelUrl || j.pbrModelUrl,
          baseModelUrl: result.baseModelUrl || j.baseModelUrl,
          cloudModelUrl: result.modelUrl,
          cloudPbrModelUrl: result.pbrModelUrl || j.cloudPbrModelUrl,
          cloudBaseModelUrl: result.baseModelUrl || j.cloudBaseModelUrl,
          previewImageUrl: result.previewImageUrl || j.previewImageUrl,
          previewHint: '模型已就绪 · 已从云端任务恢复（未重复计费）',
          error: undefined,
          updatedAt: Date.now(),
        });
        continue;
      }
    }

    if (j.status === 'ready') {
      out.push(j);
      continue;
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
