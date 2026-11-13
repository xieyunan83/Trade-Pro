import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Upload,
  Type,
  Loader2,
  Download,
  Trash2,
  Package,
  Layers,
  Sparkles,
  KeyRound,
  Save,
  Scissors,
  Puzzle,
  Grid3X3,
  Paintbrush,
  Bone,
  Printer,
  Wrench,
} from 'lucide-react';
import type { User } from '../types';
import { ModuleType } from '../types';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import {
  type Model3dJob,
  type Model3dMode,
  type Model3dQuality,
  type Model3dWorkbenchTool,
  type Model3dMeshOp,
  loadModel3dJobs,
  saveModel3dJobs,
  newCreativeId,
} from '../services/creativeStudioStore';
import {
  ensureOfficialModelTaskId,
  fetchTripoTaskOnce,
  generateModel3d,
  getModel3dProviderStatus,
  hydrateModel3dProvider,
  isModel3dEditReady,
  isTripoOfficialReady,
  recoverModel3dJobs,
  runTripoPostProcess,
  sanitizeModel3dJobs,
  type Model3dTextureQuality,
  type TripoConvertFormat,
  type TripoPostProcessKind,
  type TripoSegmentGranularity,
  type TripoRigType,
} from '../services/model3dService';
import {
  fetchQwenTripoTaskOnce,
  getQwenTripo3dProviderStatus,
} from '../services/qwenTripo3dService';
import { loadDataProviderLocal, saveDataProvider } from '../services/dataProviders';
import { consumeCreativeHandoff } from '../services/creativeAssetBridge';
import { persistModel3dJob, purgeDeletedCreativeMedia } from '../services/creativeAssetPersist';
import {
  findBestLocalTexturedModel3dForJob,
  findModel3dVaultRefForJob,
  findOriginalModel3dVaultRefForJob,
  glbBlobLikelyHasTextures,
  isVaultRef,
  model3dVaultIdForJob,
  preserveOriginalModel3dInVault,
  putBlobInVault,
  resolveMediaBlob,
  resolveMediaUrl,
  tryPersistMediaUrl,
  vaultIdFromRef,
} from '../services/creativeAssetVault';
import { CreativePipelineBar, CreativeRefPicker } from './CreativeRefPicker';
import { MODEL3D_SKILLS, type Model3dSkillId } from '../services/creativeSkills/model3dSkills';
import { UNIVERSAL_3D_NEGATIVES, mergeNegatives } from '../services/creativeQualityKit';
import { Model3dOrbitViewer } from './Model3dOrbitViewer';
import { CreativeStorageBadge } from './CreativeStorageBadge';
import { VaultImg, useVaultUrl } from './VaultMedia';

/** three.js 很重：仅进入「分件预览」时再拉，避免拖垮整个 3D 设计模块首屏 chunk */
const Model3dPartsViewer = lazy(() =>
  import('./Model3dPartsViewer').then((m) => ({ default: m.Model3dPartsViewer }))
);

type Props = {
  currentUser: User;
  onNavigateModule?: (mod: ModuleType) => void;
};

/**
 * 产品设计 · 3D：图/文生 3D、品质档、真实 GLB 导出。
 */
export const ModuleProductDesign3D: React.FC<Props> = ({ currentUser, onNavigateModule }) => {
  const [jobs, setJobs] = useState<Model3dJob[]>([]);
  const [mode, setMode] = useState<Model3dMode>('image');
  const [modelSkillId, setModelSkillId] = useState<Model3dSkillId>('turntable_hero');
  const [quality, setQuality] = useState<Model3dQuality>('high_detail');
  /** 默认高清：与此前可用路径一致；极致为可选增强 */
  const [textureQuality, setTextureQuality] = useState<Model3dTextureQuality>('detailed');
  const [alignImage, setAlignImage] = useState(true);
  const [autoSize, setAutoSize] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState(
    () => MODEL3D_SKILLS.find((s) => s.id === 'turntable_hero')?.negativeHints || ''
  );
  const [sourceImages, setSourceImages] = useState<string[]>([]);
  const [skuPick, setSkuPick] = useState('');
  const [skuName, setSkuName] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<'info' | 'error' | 'ok'>('info');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [provider, setProvider] = useState(() => getModel3dProviderStatus());
  const [hydrating, setHydrating] = useState(true);
  /** 记住上次打开的项目，客户端重进直接预览，避免空白一直转圈 */
  const LS_ACTIVE_3D = 'trade_pro_model3d_active_id_v1';
  const jobHasPreviewableModel = (j: Model3dJob) =>
    !!(j.modelUrl || j.pbrModelUrl || j.baseModelUrl || j.originalModelUrl);
  const pickDefaultModel3dJobId = (
    list: Model3dJob[],
    preferred?: string | null
  ): string | null => {
    if (preferred) {
      const hit = list.find(
        (j) => j.id === preferred && j.status === 'ready' && jobHasPreviewableModel(j)
      );
      if (hit) return hit.id;
    }
    const sorted = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const ready = sorted.find((j) => j.status === 'ready' && jobHasPreviewableModel(j));
    return ready?.id || sorted[0]?.id || null;
  };
  const [quickKey, setQuickKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  /** 制造工作台当前工具 */
  const [workbenchTool, setWorkbenchTool] = useState<Model3dWorkbenchTool>('generate');
  const [segmentGranularity, setSegmentGranularity] =
    useState<TripoSegmentGranularity>('balanced');
  const [retopoFaceLimit, setRetopoFaceLimit] = useState(8000);
  const [retopoQuad, setRetopoQuad] = useState(true);
  const [rigType, setRigType] = useState<TripoRigType>('biped');
  /**
   * 预览模式：
   * - original：拆分前原模（必须可找回）
   * - parts：分件着色
   * - current：当前 modelUrl（拆分后=分件整体环视）
   */
  type PreviewMode = 'original' | 'parts' | 'current';
  /** 默认原模环视；分件着色必须用户主动点「分件着色 / 看拆分效果」 */
  const [previewMode, setPreviewMode] = useState<PreviewMode>('original');
  const [partNames, setPartNames] = useState<string[]>([]);
  const [recoveringOriginal, setRecoveringOriginal] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const glbFileRef = useRef<HTMLInputElement>(null);
  const workbenchPanelRef = useRef<HTMLDivElement>(null);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const active = jobs.find((j) => j.id === activeId) || null;
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'director';
  /** 千问主通道或官方编辑通道任一即可做拆分/重拓扑等 */
  const editChannelReady = isModel3dEditReady();
  const qwenEditReady = getQwenTripo3dProviderStatus().ready;
  const hasSegmentResult = !!(
    active?.segmentTaskId || active?.meshOps?.some((o) => o.kind === 'segment')
  );
  const hasOriginalModel = !!(
    active?.originalModelUrl ||
    active?.baseModelUrl ||
    (hasSegmentResult && active?.sourceTaskId)
  );

  const openSegmentWorkbench = (opts?: { viewParts?: boolean }) => {
    setWorkbenchTool('segment');
    // 仅明确要求看分件时才切；默认保持原模
    if (opts?.viewParts === true && hasSegmentResult) {
      setPreviewMode('parts');
      setMsgTone('ok');
      setMsg(
        partNames.length
          ? `部件预览：共 ${partNames.length} 件。拖拽旋转，底部调节炸开；可切「原模」看拆分前`
          : '部件预览已打开。拖拽旋转 / 滚轮缩放；可切「原模」看拆分前'
      );
    } else {
      // 打开拆分工作台也不自动进分件着色；无原模地址则保持当前 GLB
      const hasOrig = !!(active?.originalModelUrl || active?.baseModelUrl);
      setPreviewMode(hasOrig ? 'original' : 'current');
    }
    requestAnimationFrame(() => {
      workbenchPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  // 打开任务：优先本机「有色」网格，绝不默认去烧云端额度
  // - 未拆分：看 current（pbr/成片）
  // - 已拆分：看 original（本机 _orig 彩色原模），不要默认看灰分件
  useEffect(() => {
    if (!active) {
      setPreviewMode('current');
      setPartNames([]);
      return;
    }
    const isLocal = (u?: string) =>
      !!u && (isVaultRef(u) || u.startsWith('blob:') || u.startsWith('data:'));
    const hasLocalOrig = [active.originalModelUrl, active.baseModelUrl].some(isLocal);
    if (hasSegmentResult && (hasLocalOrig || active.sourceTaskId)) {
      setPreviewMode('original');
    } else {
      setPreviewMode('current');
    }
    setPartNames([]);
  }, [active?.id, hasSegmentResult]);

  useEffect(() => {
    if (!activeId) return;
    try {
      localStorage.setItem(LS_ACTIVE_3D, activeId);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  // 打开任务：仅当原模槽缺失/误指主槽分件时，才用本机彩色候选回填（禁止覆盖已有 _orig）
  useEffect(() => {
    if (!active || active.status !== 'ready') return;
    let cancelled = false;
    void (async () => {
      try {
        const segmented = !!(active.segmentTaskId || '').trim();
        const primaryId = model3dVaultIdForJob(active.id);
        const primaryRef = `vault:${primaryId}`;
        const curOrig = (active.originalModelUrl || '').trim();
        const origIsPrimary =
          !!curOrig &&
          (curOrig === primaryRef ||
            curOrig === (active.modelUrl || '').trim() ||
            (isVaultRef(curOrig) && vaultIdFromRef(curOrig) === primaryId));
        const origOk =
          !!curOrig &&
          (curOrig.includes('_orig') ||
            (isVaultRef(curOrig) && !origIsPrimary) ||
            curOrig.startsWith('blob:') ||
            curOrig.startsWith('data:'));
        // 已有独立原模槽：绝不自动改写，避免把分件/灰模灌进「原模」导致面目全非
        if (origOk && !origIsPrimary) return;

        const best = await findBestLocalTexturedModel3dForJob(active);
        if (cancelled || !best) return;
        if (best === primaryRef || best === (active.modelUrl || '').trim()) return;
        if (active.originalModelUrl === best) return;
        patchJob(active.id, {
          originalModelUrl: best,
          ...(!segmented && !isVaultRef(active.pbrModelUrl)
            ? { pbrModelUrl: best }
            : {}),
          updatedAt: Date.now(),
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.status, active?.segmentTaskId]);

  useEffect(() => {
    let cancelled = false;
    const onCleared = () => {
      try {
        setJobs(sanitizeModel3dJobs(loadModel3dJobs()));
      } catch {
        setJobs([]);
      }
    };
    window.addEventListener('trade-pro-creative-media-cleared', onCleared);
    (async () => {
      setHydrating(true);
      // 先让出首屏，再读本机任务；禁止进模块同步 JSON.parse/落盘堵死点击
      await new Promise<void>((r) => {
        window.requestAnimationFrame(() => window.setTimeout(r, 0));
      });
      if (cancelled) return;
      const cleaned = sanitizeModel3dJobs(loadModel3dJobs());
      saveModel3dJobs(cleaned);
      setJobs(cleaned);
      let preferred: string | null = null;
      try {
        preferred = localStorage.getItem(LS_ACTIVE_3D);
      } catch {
        preferred = null;
      }
      setActiveId((id) => id || pickDefaultModel3dJobId(cleaned, preferred));
      const stuck = cleaned.filter((j) => j.status === 'failed' && (j.error || '').includes('中断'));
      if (stuck.length) {
        setMsgTone('error');
        setMsg(
          `发现 ${stuck.length} 条中断的 3D 任务（刷新时卡在准备预览）。请在右侧删除后重新生成；云端可能已扣费。`
        );
      }

      const st = await hydrateModel3dProvider();
      if (cancelled) return;
      setProvider(st);
      setHydrating(false);
      if (!st.ready) {
        setMsgTone('error');
        setMsg(st.detail);
      }

      try {
        const recovered = await recoverModel3dJobs(loadModel3dJobs());
        if (cancelled) return;
        saveModel3dJobs(recovered);
        setJobs(recovered);
        const revived = recovered.filter((j) => j.previewHint?.includes('已从云端恢复'));
        if (revived.length) {
          setMsgTone('ok');
          setMsg(`已从云端恢复 ${revived.length} 个 3D 模型，可预览/下载`);
        }
        setActiveId((id) => {
          try {
            preferred = localStorage.getItem(LS_ACTIVE_3D);
          } catch {
            /* keep */
          }
          return pickDefaultModel3dJobId(recovered, id || preferred);
        });

        // 仅对仍是远程链的 ready 任务后台落库；已 vault/blob 的跳过，避免进模块就串行重下
        void (async () => {
          try {
            const { shouldSkipCreativeRemigration } = await import('../services/creativeAssetVault');
            if (shouldSkipCreativeRemigration()) return;
          } catch {
            /* ignore */
          }
          const migrated: Model3dJob[] = [];
          for (const j of recovered) {
            const primary = (j.pbrModelUrl || j.modelUrl || j.baseModelUrl || '').trim();
            const alreadyLocal =
              !primary ||
              isVaultRef(primary) ||
              primary.startsWith('blob:') ||
              primary.startsWith('data:');
            if (j.status === 'ready' && primary && !alreadyLocal) {
              migrated.push(await persistModel3dJob(j));
            } else {
              migrated.push(j);
            }
          }
          if (cancelled) return;
          saveModel3dJobs(migrated);
          setJobs(migrated);
        })();
      } catch (e) {
        console.warn('3d jobs recover/migrate', e);
      }
    })();
    // 预热预览组件，避免首次打开再等 chunk
    void import('@google/model-viewer').catch(() => undefined);
    return () => {
      cancelled = true;
      window.removeEventListener('trade-pro-creative-media-cleared', onCleared);
    };
  }, []);

  useEffect(() => {
    const handoff = consumeCreativeHandoff('design_3d');
    if (!handoff?.images?.[0]) return;
    setMode('image');
    void (async () => {
      const imgs = await Promise.all(
        handoff.images.slice(0, 4).map((u) => tryPersistMediaUrl(u, 'image'))
      );
      setSourceImages(imgs);
    })();
    if (handoff.skuCode) setSkuPick(handoff.skuCode);
    if (handoff.skuName) setSkuName(handoff.skuName);
    setMsgTone('ok');
    setMsg(
      handoff.note
        ? `已从平面设计带入 ${Math.min(handoff.images.length, 4)} 张参考图：${handoff.note}`
        : `已从平面设计带入 ${Math.min(handoff.images.length, 4)} 张参考图（可多选多角度），可直接生成 3D`
    );
  }, []);

  const saveQuickKey = async () => {
    const key = quickKey.replace(/^\uFEFF/, '').replace(/^Bearer\s+/i, '').replace(/\s+/g, '').trim();
    if (!key) {
      setMsgTone('error');
      setMsg('请粘贴图生 3D API Key（数据接入通道 Key / 备选均可）');
      return;
    }
    setSavingKey(true);
    // sk- → 千问 MaaS · Tripo；tsk_ → Tripo 官方；其余 → 混元备选
    const target = /^sk-/i.test(key) ? 'qwen_tripo' : /^tsk_/i.test(key) ? 'tripo' : 'hunyuan3d';
    const prev = loadDataProviderLocal(target);
    await saveDataProvider(target, {
      ...prev,
      enabled: true,
      apiKey: key,
      ...(target === 'qwen_tripo'
        ? {
            apiBase: prev.apiBase?.trim() || 'https://cn-beijing.maas.qianwenaiapi.com',
            extra: { ...(prev.extra || {}), modelId: prev.extra?.modelId || 'Tripo/Tripo-H3.1' },
          }
        : {}),
    });
    const st = getModel3dProviderStatus();
    setProvider(st);
    setSavingKey(false);
    setQuickKey('');
    const editOk = isModel3dEditReady();
    setMsgTone(st.ready || editOk ? 'ok' : 'error');
    setMsg(
      target === 'qwen_tripo' && st.ready
        ? '3D 主通道已启用：可生成，也可直接拆分 / 重拓扑 / 导出制造格式'
        : target === 'tripo' && isTripoOfficialReady()
          ? '官方编辑通道已启用：可拆分 / 重拓扑 / STL 导出'
          : st.ready
            ? target === 'hunyuan3d'
              ? '3D 备选 Key 已保存并启用，可以开始生成'
              : '3D API 已保存并启用'
            : st.detail
    );
  };

  const persist = (next: Model3dJob[]) => {
    setJobs(next);
    saveModel3dJobs(next);
  };

  const patchJob = (id: string, patch: Partial<Model3dJob>) => {
    setJobs((prev) => {
      const next = prev.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: Date.now() } : j));
      saveModel3dJobs(next);
      return next;
    });
  };

  const onPickImages = (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 4);
    list.forEach((file) => {
      if (!file.type.startsWith('image/')) {
        setMsgTone('error');
        setMsg('请上传图片文件');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setMsgTone('error');
        setMsg('单张图片请小于 10MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        setSourceImages((prev) => [...prev, String(reader.result || '')].slice(0, 4));
      reader.readAsDataURL(file);
    });
  };

  /** 导入已有 GLB：先用 blob: 立刻预览，后台再写入素材库 */
  const onPickGlb = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    const okExt = lower.endsWith('.glb') || lower.endsWith('.gltf');
    const okMime =
      file.type === 'model/gltf-binary' ||
      file.type === 'model/gltf+json' ||
      file.type === 'application/octet-stream' ||
      !file.type;
    if (!okExt && !okMime) {
      setMsgTone('error');
      setMsg('请上传 .glb 或 .gltf 文件');
      return;
    }
    if (file.size > 120 * 1024 * 1024) {
      setMsgTone('error');
      setMsg('GLB 过大（上限约 120MB）');
      return;
    }
    setBusy(true);
    setMsgTone('info');
    setMsg('正在打开本地 GLB…');
    const now = Date.now();
    const jobId = newCreativeId('m3d');
    const mime =
      file.type || (lower.endsWith('.gltf') ? 'model/gltf+json' : 'model/gltf-binary');
    const objectUrl = URL.createObjectURL(file);
    const job: Model3dJob = {
      id: jobId,
      title: `本地导入 · ${file.name.replace(/\.(glb|gltf)$/i, '')}`,
      mode: 'image',
      quality: 'engine_ready',
      prompt: '',
      status: 'ready',
      progress: 100,
      modelUrl: objectUrl,
      exportFormats: ['GLB'],
      previewHint: '本地 GLB · 可环视预览 · 下载后可导入切片软件做 3D 打印',
      ownerUsername: currentUser.username,
      createdAt: now,
      updatedAt: now,
    };
    persist([job, ...jobs.filter((j) => j.id !== job.id)]);
    setActiveId(jobId);
    setMsgTone('ok');
    setMsg('本地 GLB 已打开预览；正在写入本机素材库…');
    setBusy(false);
    void (async () => {
      try {
        const vaultRef = await putBlobInVault({
          blob: file,
          kind: 'model3d',
          id: `imp_${jobId}`,
          sourceHint: file.name,
          mime,
        });
        patchJob(jobId, {
          modelUrl: vaultRef,
          previewHint: '本地 GLB · 已存本机 · 可环视 / 下载打印',
        });
        setMsgTone('ok');
        setMsg('本地 GLB 已写入本机素材库，刷新后仍可预览');
      } catch (e: any) {
        console.warn('[3d] import vault failed', e);
        setMsgTone('info');
        setMsg('预览可用；本机素材库未写入，请尽快下载 GLB 备份');
      }
    })();
  };

  const runGenerate = async () => {
    const live = getModel3dProviderStatus();
    setProvider(live);
    if (!live.ready) {
      setMsgTone('error');
      setMsg(live.detail);
      window.alert(live.detail);
      return;
    }
    if (mode === 'image' && !sourceImages.length) {
      setMsgTone('error');
      setMsg('请先选用或上传产品图（可多选多角度）');
      window.alert('请先选用或上传产品图，再生成 3D');
      return;
    }
    if (mode === 'text' && !prompt.trim()) {
      setMsgTone('error');
      setMsg('请填写文字描述');
      window.alert('请填写文字描述');
      return;
    }
    const sku = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const now = Date.now();
    const job: Model3dJob = {
      id: newCreativeId('m3d'),
      title: sku
        ? `${sku.skuCode} · 3D`
        : skuPick
          ? `${skuPick} · 3D`
          : mode === 'image'
            ? sourceImages.length > 1
              ? `多视图 3D · ${sourceImages.length} 张`
              : '图生 3D'
            : `文生 3D · ${prompt.trim().slice(0, 24)}`,
      mode,
      quality,
      prompt: prompt.trim(),
      sourceImage: sourceImages[0],
      sourceImages: sourceImages.slice(0, 4),
      skuCode: sku?.skuCode || skuPick || undefined,
      skuName: sku?.name || skuName,
      status: 'running',
      progress: 0,
      exportFormats: ['GLB'],
      ownerUsername: currentUser.username,
      createdAt: now,
      updatedAt: now,
    };
    persist([job, ...jobs]);
    setActiveId(job.id);
    setBusy(true);
    setMsgTone('info');
    setMsg(
      sourceImages.length > 1
        ? `正在提交多视图 3D 任务（${sourceImages.length} 张）…`
        : '正在提交 3D 任务…'
    );

    const skill =
      MODEL3D_SKILLS.find((s) => s.id === modelSkillId) || MODEL3D_SKILLS[0];
    const fullPrompt = (prompt.trim() || skill.defaultPrompt).slice(0, 1024);
    const mergedNegative = mergeNegatives(
      UNIVERSAL_3D_NEGATIVES,
      negativePrompt.trim() || skill.negativeHints
    ).slice(0, 255);

    try {
      const result = await generateModel3d({
        mode,
        prompt: fullPrompt,
        negativePrompt: mergedNegative || undefined,
        sourceImage: sourceImages[0],
        sourceImages,
        quality,
        textureQuality:
          quality === 'engine_ready' && textureQuality === 'extreme'
            ? 'detailed'
            : textureQuality,
        alignImage: mode === 'image' ? alignImage : false,
        autoSize,
        faceLimit: quality === 'engine_ready' ? 20000 : undefined,
        onTaskCreated: (taskId) => {
          patchJob(job.id, { providerTaskId: taskId });
        },
        onProgress: (pct, status) => {
          const s = (status || '').toLowerCase();
          const label =
            s === 'uploading' || s === 'uploaded'
              ? '上传参考图'
              : s === 'running' || s === 'queued'
                ? '重建网格'
                : s === 'succeeded' || s === 'success' || s === 'completed'
                  ? '云端已完成'
                  : s === 'fallback'
                    ? '切换通道'
                    : status || '处理中';
          patchJob(job.id, {
            progress: Math.round(pct),
            previewHint: `${label} ${Math.round(pct)}%`,
          });
          setMsgTone('info');
          setMsg(`${label} ${Math.round(pct)}%`);
        },
      });

      // 云端成功后立刻可预览/下载，不再阻塞等待本机落库（大 GLB 曾导致卡在 100% 半小时）
      const readyNow: Model3dJob = {
        ...job,
        status: 'ready',
        progress: 100,
        provider: result.provider || 'tripo',
        modelVersion: result.modelVersion,
        providerTaskId: result.taskId,
        sourceTaskId: result.sourceTaskId || result.taskId,
        modelUrl: result.modelUrl,
        pbrModelUrl: result.pbrModelUrl,
        baseModelUrl: result.baseModelUrl,
        originalModelUrl: result.modelUrl,
        originalPreviewImageUrl: result.previewImageUrl,
        previewImageUrl: result.previewImageUrl,
        previewHint: '模型已就绪 · 可拖动环视 · 正在写入本机缓存…',
        error: undefined,
        updatedAt: Date.now(),
      };
      patchJob(job.id, {
        status: 'ready',
        progress: 100,
        provider: readyNow.provider,
        modelVersion: readyNow.modelVersion,
        providerTaskId: readyNow.providerTaskId,
        sourceTaskId: readyNow.sourceTaskId,
        modelUrl: readyNow.modelUrl,
        pbrModelUrl: readyNow.pbrModelUrl,
        baseModelUrl: readyNow.baseModelUrl,
        originalModelUrl: readyNow.originalModelUrl,
        originalPreviewImageUrl: readyNow.originalPreviewImageUrl,
        previewImageUrl: readyNow.previewImageUrl,
        previewHint: readyNow.previewHint,
        error: undefined,
      });
      setBusy(false);
      setMsgTone('ok');
      setMsg('3D 已生成，可预览 / 下载；本机缓存写入中…');

      void (async () => {
        try {
          const vaulted = await persistModel3dJob(readyNow);
          const cached = [vaulted.modelUrl, vaulted.pbrModelUrl, vaulted.baseModelUrl].some(
            (u) => u && isVaultRef(u)
          );
          patchJob(job.id, {
            modelUrl: vaulted.modelUrl,
            pbrModelUrl: vaulted.pbrModelUrl,
            baseModelUrl: vaulted.baseModelUrl,
            originalModelUrl: vaulted.originalModelUrl || vaulted.modelUrl,
            originalPreviewImageUrl:
              vaulted.originalPreviewImageUrl || vaulted.previewImageUrl,
            previewImageUrl: vaulted.previewImageUrl,
            sourceImage: vaulted.sourceImage,
            sourceImages: vaulted.sourceImages,
            previewHint: cached
              ? '模型已就绪 · 已存本机 · 可拖动环视'
              : '模型已就绪 · 请尽快下载（本机缓存未写入，临时链可能过期）',
            updatedAt: Date.now(),
          });
          setMsgTone('ok');
          setMsg(
            cached
              ? '3D 已生成并写入本机素材库，刷新后仍可预览；也可下载 GLB'
              : '3D 已生成。本机缓存未写入，请尽快下载 GLB，避免临时链过期'
          );
        } catch {
          patchJob(job.id, {
            previewHint: '模型已就绪 · 请尽快下载（本机缓存失败，临时链可能过期）',
            updatedAt: Date.now(),
          });
        }
      })();
    } catch (e: any) {
      const { humanizeCreativeProviderError } = await import('../services/providerErrorMessage');
      const errText = humanizeCreativeProviderError(e?.message || e);
      // 先落失败态再弹窗，避免界面卡在「生成中 8%」
      patchJob(job.id, {
        status: 'failed',
        progress: 0,
        error: errText,
        previewHint: errText,
      });
      setBusy(false);
      setMsgTone('error');
      setMsg(errText);
      window.alert(`3D 生成失败：${errText}`);
      return;
    } finally {
      setBusy(false);
    }
  };

  const removeJob = (id: string) => {
    if (!confirm('删除该 3D 任务？')) return;
    const doomed = jobs.find((j) => j.id === id);
    const next = jobs.filter((j) => j.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id || null);
    if (doomed) {
      void purgeDeletedCreativeMedia([
        doomed.sourceImage,
        ...(doomed.sourceImages || []),
        doomed.modelUrl,
        doomed.pbrModelUrl,
        doomed.baseModelUrl,
        doomed.previewImageUrl,
        ...(doomed.convertedUrls ? Object.values(doomed.convertedUrls) : []),
      ]);
    }
  };

  /** 制造工作台后处理：拆分 / 补全 / 重拓扑 / 贴图 / 绑定 / 导出 */
  const runPostProcess = async (kind: TripoPostProcessKind, format?: TripoConvertFormat) => {
    if (!active || active.status !== 'ready') return;
    if (!editChannelReady) {
      setMsgTone('error');
      setMsg('请先启用 3D 主通道 Key（与生成同一条即可），再使用拆分 / 重拓扑 / 制造导出。');
      return;
    }
    const modelUrl = pickLocalOrRemoteModelUrl(active);
    if (!modelUrl && !(active.providerTaskId || active.officialTaskId || active.segmentTaskId)) {
      setMsgTone('error');
      setMsg('当前任务没有可用模型，请先生成或导入 GLB。');
      return;
    }
    if (kind === 'complete' && !active.segmentTaskId) {
      setMsgTone('error');
      setMsg('请先完成「部件拆分」，再执行部件补全（手板/模具分水口前需拆分）。');
      setWorkbenchTool('segment');
      return;
    }

    setBusy(true);
    setMsgTone('info');
    const kindHint =
      kind === 'segment'
        ? '正在部件拆分…'
        : kind === 'complete'
          ? '正在部件补全…'
          : kind === 'retopo' || kind === 'lowpoly'
            ? '正在重拓扑（制造减面）…'
            : kind === 'texture_hd'
              ? '正在高清贴图…'
              : kind === 'rig'
                ? '正在自动绑定…'
                : `正在导出 ${format || 'STL'}…`;
    setMsg(kindHint);

    try {
      // 优先千问主通道：直接用生成 task_id，无需再贴 tsk_
      // 仅当没有千问、只有官方 Key 时，才把模型导入官方编辑通道
      let upstreamId = '';
      let publicModelUrl: string | undefined;
      let preferModelUrl = false;
      let preferOfficial = !qwenEditReady;
      /** 后处理任务 ID：绝不能当作「首次生成」再喂给拆分 */
      const rejectTaskIds = new Set(
        [
          active.segmentTaskId,
          ...((active.meshOps || [])
            .filter((o) =>
              ['segment', 'retopo', 'texture_hd', 'rig', 'complete', 'convert'].includes(o.kind)
            )
            .map((o) => o.taskId) || []),
        ]
          .map((s) => (s || '').trim())
          .filter(Boolean)
      );
      const pickHealthyRootId = (...cands: Array<string | undefined>) =>
        cands
          .map((s) => (s || '').trim())
          .find((id) => id && !rejectTaskIds.has(id)) || '';

      if (qwenEditReady) {
        if (kind === 'complete') {
          upstreamId = (active.segmentTaskId || '').trim();
        } else if (kind === 'segment') {
          // 只挂首次生成；拒绝上一次拆分/后处理 ID（否则常原样回传 1 块）
          upstreamId = pickHealthyRootId(
            active.sourceTaskId,
            active.provider === 'qwen_tripo' ? active.providerTaskId : '',
            active.provider === 'tripo' ? active.providerTaskId : ''
          );
          // 仅原模公网链；禁止把已落库的分件 https 再喂回去
          publicModelUrl = [active.originalModelUrl, active.baseModelUrl].find(
            (u) => u && /^https?:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u)
          );
          if (!upstreamId && publicModelUrl) {
            preferModelUrl = true;
          } else if (
            publicModelUrl &&
            (rejectTaskIds.has((active.sourceTaskId || '').trim()) || !!active.segmentTaskId)
          ) {
            // 已拆过或 source 已脏：强制原模 URL，避免拆分套拆分空耗额度
            preferModelUrl = true;
            upstreamId = '';
          }
          if (!upstreamId && !publicModelUrl) {
            const origRef =
              (await findOriginalModel3dVaultRefForJob(active)) ||
              active.originalModelUrl ||
              active.baseModelUrl ||
              '';
            if (origRef && isTripoOfficialReady()) {
              setMsg('原模仅在本机，正在导入编辑通道后拆分…');
              const resolved = (await resolveMediaUrl(origRef)) || origRef;
              upstreamId = await ensureOfficialModelTaskId({
                modelUrl: resolved,
                onProgress: (pct, status) => {
                  patchJob(active.id, {
                    status: 'running',
                    progress: Math.min(35, Math.round(pct * 0.35)),
                    previewHint: `导入原模 ${status} ${Math.round(pct)}%`,
                  });
                },
              });
              preferOfficial = true;
              if (upstreamId !== active.officialTaskId) {
                patchJob(active.id, { officialTaskId: upstreamId });
              }
            } else {
              throw new Error(
                '找不到可用的「首次生成」任务或原模公网地址。请重新生成 3D（勿清空本机素材）后再拆分；已拆坏的任务请勿连续重试以免重复计费。'
              );
            }
          }
        } else {
          upstreamId = pickHealthyRootId(
            active.providerTaskId,
            active.sourceTaskId,
            active.segmentTaskId
          );
          publicModelUrl = [active.modelUrl, active.pbrModelUrl, active.baseModelUrl, modelUrl].find(
            (u) => u && /^https?:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u)
          );
        }
        if (!upstreamId && !publicModelUrl && !isTripoOfficialReady()) {
          throw new Error(
            '当前模型没有云端生成任务 ID 或公网地址。请用主通道重新生成后再拆分（勿只用本机 vault）。'
          );
        }
      } else {
        const importUrl =
          kind === 'segment'
            ? await (async () => {
                const origHttps = [active.originalModelUrl, active.baseModelUrl].find(
                  (u) => u && /^https?:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u)
                );
                if (origHttps) return origHttps;
                const origRef =
                  (await findOriginalModel3dVaultRefForJob(active)) ||
                  active.originalModelUrl ||
                  active.baseModelUrl ||
                  modelUrl;
                if (!origRef) return modelUrl;
                if (isVaultRef(origRef) || origRef.startsWith('blob:')) {
                  return (await resolveMediaUrl(origRef)) || origRef;
                }
                return origRef;
              })()
            : modelUrl;
        const officialId = await ensureOfficialModelTaskId({
          provider: active.provider,
          providerTaskId:
            kind === 'segment'
              ? pickHealthyRootId(
                  active.sourceTaskId,
                  active.provider === 'tripo' ? active.providerTaskId : ''
                ) || undefined
              : active.providerTaskId,
          officialTaskId: kind === 'segment' ? undefined : active.officialTaskId,
          modelUrl: importUrl,
          onProgress: (pct, status) => {
            patchJob(active.id, {
              status: 'running',
              progress: Math.min(35, Math.round(pct * 0.35)),
              previewHint: `导入编辑通道 ${status} ${Math.round(pct)}%`,
            });
          },
        });
        if (officialId !== active.officialTaskId) {
          patchJob(active.id, { officialTaskId: officialId });
        }
        upstreamId =
          kind === 'complete'
            ? (active.segmentTaskId || officialId).trim()
            : kind === 'segment'
              ? officialId
              : (active.provider === 'tripo'
                  ? active.providerTaskId || officialId
                  : officialId
                ).trim();
      }

      // 拆分前先固化原模（尚未写 segmentTaskId，才能把主槽拷到 _orig）
      // 彩色优先：绝不能把无贴图 base 灰模排在 PBR/主槽前面，否则「原模」永远面目全非
      const keepOriginal =
        active.originalModelUrl ||
        (kind === 'segment'
          ? active.pbrModelUrl || active.modelUrl || active.baseModelUrl
          : kind !== 'convert'
            ? active.pbrModelUrl || active.modelUrl || active.baseModelUrl
            : undefined);
      let vaultedOriginal: string | undefined;
      if (kind === 'segment') {
        try {
          vaultedOriginal =
            (await preserveOriginalModel3dInVault({
              ...active,
              segmentTaskId: undefined,
              originalModelUrl: keepOriginal || active.originalModelUrl,
            })) || undefined;
        } catch {
          /* 原模备份失败不阻断 */
        }
      }

      const result = await runTripoPostProcess({
        kind,
        originalTaskId: upstreamId || undefined,
        modelUrl: publicModelUrl,
        preferModelUrl: kind === 'segment' ? preferModelUrl : undefined,
        format,
        texturePrompt: prompt.trim() || undefined,
        faceLimit: retopoFaceLimit,
        quad: retopoQuad,
        segmentGranularity,
        rigType,
        preferOfficial,
        onTaskCreated: (tid) => {
          // 拆分：创建时不写 segmentTaskId，避免 preserve 跳过主槽拷贝
          if (kind === 'segment') {
            patchJob(active.id, {
              ...(preferOfficial || !qwenEditReady ? { officialTaskId: tid } : {}),
              previewHint: '拆分任务已创建…',
            });
            return;
          }
          patchJob(active.id, {
            providerTaskId: tid,
            ...(qwenEditReady ? {} : { officialTaskId: tid }),
          });
        },
        onProgress: (pct, status) => {
          patchJob(active.id, {
            status: 'running',
            progress: Math.round(qwenEditReady && !preferOfficial ? pct : 35 + pct * 0.65),
            previewHint: `${kindHint.replace('…', '')} · ${status} ${Math.round(pct)}%`,
          });
        },
      });

      const converted =
        kind === 'convert' && format
          ? { ...(active.convertedUrls || {}), [format]: result.modelUrl }
          : active.convertedUrls;
      const formats = Array.from(
        new Set([...(active.exportFormats || ['GLB']), ...(format ? [format] : ['GLB'])])
      );
      const opKind =
        kind === 'lowpoly'
          ? 'retopo'
          : kind === 'texture_hd'
            ? 'texture_hd'
            : kind === 'convert'
              ? 'convert'
              : kind === 'segment'
                ? 'segment'
                : kind === 'complete'
                  ? 'complete'
                  : kind === 'rig'
                    ? 'rig'
                    : 'retopo';
      const op: Model3dMeshOp = {
        kind: opKind,
        taskId: result.taskId,
        label: result.label,
        at: Date.now(),
      };
      if (kind !== 'convert' && kind !== 'segment') {
        try {
          vaultedOriginal =
            (await preserveOriginalModel3dInVault({
              ...active,
              originalModelUrl: keepOriginal || active.originalModelUrl,
            })) || vaultedOriginal;
        } catch {
          /* ignore */
        }
      }
      const healedSourceId = pickHealthyRootId(
        kind === 'segment' ? upstreamId : '',
        active.sourceTaskId,
        active.provider === 'qwen_tripo' || active.provider === 'tripo'
          ? active.providerTaskId
          : '',
        result.sourceTaskId
      );
      const next: Partial<Model3dJob> = {
        status: 'ready',
        progress: 100,
        provider: result.provider || active.provider,
        providerTaskId:
          kind === 'segment'
            ? pickHealthyRootId(active.providerTaskId, healedSourceId) ||
              active.providerTaskId ||
              healedSourceId
            : result.taskId,
        officialTaskId:
          preferOfficial || !qwenEditReady
            ? result.taskId || active.officialTaskId
            : active.officialTaskId,
        sourceTaskId:
          kind === 'segment'
            ? healedSourceId || active.sourceTaskId
            : healedSourceId || active.sourceTaskId || result.taskId,
        segmentTaskId: kind === 'segment' ? result.taskId : active.segmentTaskId,
        modelUrl: kind === 'convert' ? active.modelUrl || result.modelUrl : result.modelUrl,
        // 拆分：分件只进 modelUrl；pbr 保留拆分前彩色成片，禁止用分件灰/色块覆盖
        pbrModelUrl:
          kind === 'convert'
            ? active.pbrModelUrl
            : kind === 'segment'
              ? active.pbrModelUrl ||
                vaultedOriginal ||
                keepOriginal ||
                active.originalModelUrl ||
                active.modelUrl
              : result.pbrModelUrl || result.modelUrl,
        baseModelUrl:
          kind === 'convert'
            ? active.baseModelUrl
            : kind === 'segment'
              ? active.baseModelUrl || vaultedOriginal || keepOriginal
              : result.baseModelUrl ||
                vaultedOriginal ||
                active.baseModelUrl ||
                keepOriginal,
        originalModelUrl: vaultedOriginal || keepOriginal || active.originalModelUrl,
        originalPreviewImageUrl:
          active.originalPreviewImageUrl || active.previewImageUrl,
        previewImageUrl: result.previewImageUrl || active.previewImageUrl,
        convertedUrls: converted,
        exportFormats: formats,
        meshOps: [...(active.meshOps || []), op].slice(-20),
        previewHint:
          kind === 'segment'
            ? '拆分完成 · 正在打开分件着色'
            : `${result.label}完成 · 可环视 / 导出制造格式`,
        error: undefined,
        updatedAt: Date.now(),
      };
      if (
        kind === 'segment' &&
        next.sourceTaskId &&
        (next.sourceTaskId === result.taskId || rejectTaskIds.has(next.sourceTaskId))
      ) {
        next.sourceTaskId = healedSourceId || undefined;
      }
      patchJob(active.id, next);
      setBusy(false);
      setMsgTone('ok');
      if (kind === 'segment') {
        if (result.partNames?.length) {
          setPartNames(result.partNames);
        }
        setPreviewMode('parts');
        setWorkbenchTool('segment');
        setMsg(
          result.partNames?.length
            ? `部件拆分完成：API 返回 ${result.partNames.length} 个部件，已切换到分件着色 / 可炸开`
            : '部件拆分完成：已切换到分件着色。若仍是 1 块，请选「精细」再拆一次（本次已纠正上游任务）'
        );
      } else {
        setMsg(
          kind === 'convert'
            ? `${format} 已就绪，可用于 3D 打印 / 手板 / 模具`
            : `${result.label}完成`
        );
      }
      if (kind !== 'convert') {
        const merged = { ...active, ...next } as Model3dJob;
        void persistModel3dJob(merged).then((vaulted) => {
          patchJob(active.id, {
            modelUrl: vaulted.modelUrl,
            pbrModelUrl: vaulted.pbrModelUrl,
            baseModelUrl: vaulted.baseModelUrl,
            originalModelUrl: vaulted.originalModelUrl || vaultedOriginal || keepOriginal,
            previewImageUrl: vaulted.previewImageUrl,
            sourceTaskId: merged.sourceTaskId,
            segmentTaskId: merged.segmentTaskId,
            providerTaskId: merged.providerTaskId,
          });
        });
      }
    } catch (e: any) {
      const { humanizeCreativeProviderError } = await import('../services/providerErrorMessage');
      const errText = humanizeCreativeProviderError(e?.message || e);
      patchJob(active.id, {
        status: 'ready',
        progress: 100,
        error: errText,
        previewHint: active.previewHint || '后处理失败，原模型仍可下载',
      });
      setBusy(false);
      setMsgTone('error');
      setMsg(errText);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 选预览地址。拆分后「原模」与「当前/分件」必须隔离：
   * - original：只用 original / base（且不能是主槽 mesh_${id}）
   * - current：只用 model / pbr（不要回落到原模，否则「拆分后整体」看起来像原模）
   */
  const pickLocalOrRemoteModelUrl = (
    job: Model3dJob | null | undefined,
    prefer: 'current' | 'original' = 'current'
  ): string | undefined => {
    if (!job) return undefined;
    const primaryId = model3dVaultIdForJob(job.id);
    const primaryRef = `vault:${primaryId}`;
    const segmented = !!(
      job.segmentTaskId || job.meshOps?.some((o) => o.kind === 'segment')
    );
    const isLocal = (u: string) =>
      isVaultRef(u) || u.startsWith('blob:') || u.startsWith('data:');
    const isOrigSlot = (u: string) =>
      isVaultRef(u) && (u.endsWith('_orig') || u.includes('_orig'));

    if (prefer === 'original') {
      // 彩色优先：_orig → 拆分前 pbr → cloud 备份；base 灰模永远最后。
      // 拆分后禁止用主槽分件 / 已被写成同址的 pbr 冒充原模
      const isBaseSlot = (u: string) =>
        !!u &&
        (u === job.baseModelUrl ||
          (isVaultRef(u) && /base/i.test(u)) ||
          u.endsWith('_base'));
      const isSegmentSlot = (u: string) =>
        !!u &&
        (u === primaryRef ||
          u === job.modelUrl ||
          (isVaultRef(u) && vaultIdFromRef(u) === primaryId));
      const list = (
        segmented
          ? [
              job.originalModelUrl,
              // 仅当 pbr 仍指向独立彩色槽时才用（勿等于分件主槽）
              job.pbrModelUrl && !isSegmentSlot(job.pbrModelUrl) ? job.pbrModelUrl : undefined,
              job.cloudPbrModelUrl,
              job.baseModelUrl,
            ]
          : [job.originalModelUrl, job.pbrModelUrl, job.modelUrl, job.baseModelUrl]
      )
        .filter(Boolean)
        .filter((u) => {
          const s = u as string;
          if (isOrigSlot(s)) return true;
          if (segmented && isSegmentSlot(s)) return false;
          return true;
        }) as string[];
      // 有非 base 候选时绝不回落灰模
      const nonBase = list.filter((u) => !isBaseSlot(u));
      const pool = nonBase.length ? nonBase : list;
      return pool.find(isLocal) || pool[0];
    }

    // 成片预览：PBR/主网格优先，避免落到无贴图 base
    const list = (
      segmented
        ? [job.modelUrl, job.pbrModelUrl]
        : [job.pbrModelUrl, job.modelUrl, job.originalModelUrl, job.baseModelUrl]
    ).filter(Boolean) as string[];
    return list.find(isLocal) || list[0];
  };

  /**
   * 找回拆分前原模：默认只读本机素材（不烧生成额度）。
   * 仅当 opts.forceCloudTextured === true（用户点「云端补拉」）才访问云端。
   */
  /** 看原模：已有带贴图原模则直接切换；灰模占坑时再走恢复（含彩色备份链） */
  const showOriginalModel = () => {
    if (!active) return;
    void (async () => {
      const url = pickLocalOrRemoteModelUrl(active, 'original');
      const primaryId = model3dVaultIdForJob(active.id);
      const isSeg =
        !!url &&
        (url === active.modelUrl ||
          url === `vault:${primaryId}` ||
          (isVaultRef(url) && vaultIdFromRef(url) === primaryId));
      if (url && !isSeg) {
        try {
          if (isVaultRef(url) || url.startsWith('blob:') || url.startsWith('data:')) {
            const blob = await resolveMediaBlob(url);
            if (blob && !(await glbBlobLikelyHasTextures(blob))) {
              await recoverOriginalModel();
              return;
            }
          }
        } catch {
          /* 探测失败则仍直接切换 */
        }
        setPreviewMode('original');
        setMsgTone('ok');
        setMsg('原模环视（拆分前）');
        return;
      }
      await recoverOriginalModel();
    })();
  };

  const recoverOriginalModel = async (opts?: { forceCloudTextured?: boolean }) => {
    if (!active) return;
    const forceCloud = opts?.forceCloudTextured === true;

    const useLocalOriginal = (url: string, note: string) => {
      patchJob(active.id, {
        originalModelUrl: url,
        // 勿把 base 误写成灰模；保留原 base 字段
        updatedAt: Date.now(),
      });
      setPreviewMode('original');
      setMsgTone('ok');
      setMsg(note);
    };

    setRecoveringOriginal(true);
    setMsgTone('info');
    setMsg(forceCloud ? '正在从云端补拉彩色原模（可能耗额度）…' : '正在从本机素材库选择彩色原模…');
    try {
      const acceptLocalIfTextured = async (ref: string, note: string) => {
        try {
          const blob = await resolveMediaBlob(ref);
          if (blob && (await glbBlobLikelyHasTextures(blob))) {
            useLocalOriginal(ref, note);
            return true;
          }
        } catch {
          /* fall through */
        }
        return false;
      };

      // 1) 本机优先：必须带贴图，勿把分件色块/灰模标成彩色
      const bestLocal = await findBestLocalTexturedModel3dForJob(active);
      if (bestLocal && !forceCloud) {
        if (await acceptLocalIfTextured(bestLocal, '已切回本机彩色原模（未访问云端）')) return;
      }
      const localOrig = await findOriginalModel3dVaultRefForJob(active);
      if (localOrig && !forceCloud) {
        if (await acceptLocalIfTextured(localOrig, '已切回本机原模备份（未访问云端）')) return;
      }
      if (active.originalModelUrl && isVaultRef(active.originalModelUrl) && !forceCloud) {
        const oid = active.originalModelUrl.replace(/^vault:/, '');
        if (oid !== model3dVaultIdForJob(active.id)) {
          if (
            await acceptLocalIfTextured(
              active.originalModelUrl,
              '已切回本机原模预览（未访问云端）'
            )
          ) {
            return;
          }
        }
      }

      // 2) 不耗生成额度：直接拉仍有效的彩色备份 https（非重新跑任务）
      if (!forceCloud) {
        const backupHttps = [
          active.cloudPbrModelUrl,
          active.cloudModelUrl,
          active.pbrModelUrl,
        ]
          .map((u) => (u || '').trim())
          .find(
            (u) =>
              /^https?:\/\//i.test(u) &&
              u !== (active.modelUrl || '').trim()
          );
        if (backupHttps) {
          const saved =
            (await tryPersistMediaUrl(backupHttps, 'model3d', `${active.id}_orig`, {
              id: `${model3dVaultIdForJob(active.id)}_orig`,
            })) || backupHttps;
          useLocalOriginal(saved, '已从彩色备份链恢复原模并写入本机');
          return;
        }
        // 实在没有贴图文件：仍切到相对最好的本机槽，但明确提示是灰模
        if (bestLocal || localOrig) {
          useLocalOriginal(
            bestLocal || localOrig!,
            '本机原模疑似无贴图（灰模）。请点「云端补拉」或到「贴图」上色'
          );
          setMsgTone('error');
          return;
        }
        setMsgTone('error');
        setMsg(
          '本机没有可用的彩色原模。请勿清空素材；若必须补拉，再点「云端补拉原模」（可能耗额度）。也可到「贴图」对本机网格上色。'
        );
        return;
      }

      const tid = (active.sourceTaskId || active.providerTaskId || '').trim();
      if (!tid) {
        setMsgTone('error');
        setMsg('没有可查询的生成任务。请重新生成 3D，或用「设为当前任务原模」绑定本机 GLB。');
        return;
      }
      let result =
        active.provider === 'tripo'
          ? await fetchTripoTaskOnce(tid)
          : await fetchQwenTripoTaskOnce(tid);
      if (!result?.modelUrl && active.provider !== 'tripo') {
        result = (await fetchTripoTaskOnce(tid)) || result;
      }
      const textured =
        result?.pbrModelUrl || result?.modelUrl || result?.baseModelUrl || '';
      if (!textured) {
        throw new Error('云端原模已过期。请用「贴图」上色或重新生成（勿清空本机素材）。');
      }
      const saved =
        (await tryPersistMediaUrl(textured, 'model3d', `${tid}_orig`, {
          id: `${model3dVaultIdForJob(active.id)}_orig`,
        })) || textured;
      useLocalOriginal(saved, '已从云端补拉并写入本机；以后打开不再依赖云端');
    } catch (e: any) {
      setMsgTone('error');
      setMsg(e?.message || '恢复原模失败');
    } finally {
      setRecoveringOriginal(false);
    }
  };

  /** 把本地 GLB 绑到「当前任务」的原模槽，不新建任务、不清除拆分 */
  const onAttachOriginalGlb = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !active) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) {
      setMsgTone('error');
      setMsg('请上传 .glb 或 .gltf 作为拆分前原模');
      return;
    }
    if (file.size > 120 * 1024 * 1024) {
      setMsgTone('error');
      setMsg('GLB 过大（上限约 120MB）');
      return;
    }
    setBusy(true);
    setMsgTone('info');
    setMsg('正在把本地 GLB 设为当前任务的原模（分件会保留）…');
    try {
      const mime =
        file.type || (lower.endsWith('.gltf') ? 'model/gltf+json' : 'model/gltf-binary');
      const vaultRef = await putBlobInVault({
        blob: file,
        kind: 'model3d',
        id: `${model3dVaultIdForJob(active.id)}_orig`,
        sourceHint: `${active.sourceTaskId || active.id}_orig`,
        mime,
      });
      patchJob(active.id, {
        originalModelUrl: vaultRef,
        baseModelUrl: vaultRef,
        updatedAt: Date.now(),
      });
      setPreviewMode('original');
      setMsgTone('ok');
      setMsg('原模已绑定到本任务；「分件着色」仍在，可切换查看');
    } catch (e: any) {
      setMsgTone('error');
      setMsg(e?.message || '绑定原模失败');
    } finally {
      setBusy(false);
    }
  };

  // 原模模式若地址缺失，必须回落到当前 GLB，绝不能只剩平面预览图
  const rawDownloadUrl = (() => {
    if (previewMode === 'parts') {
      return pickLocalOrRemoteModelUrl(active, 'current');
    }
    if (previewMode === 'original') {
      return (
        pickLocalOrRemoteModelUrl(active, 'original') ||
        // 未拆分时 pbr 即彩色原模
        (!hasSegmentResult ? pickLocalOrRemoteModelUrl(active, 'current') : undefined)
      );
    }
    return pickLocalOrRemoteModelUrl(active, 'current');
  })();
  const rawPreviewUrl = rawDownloadUrl;
  const downloadUrl = useVaultUrl(rawDownloadUrl);
  const previewUrl = useVaultUrl(rawPreviewUrl);
  const previewPoster = useVaultUrl(
    previewMode === 'original'
      ? active?.originalPreviewImageUrl || active?.previewImageUrl || active?.sourceImage
      : active?.previewImageUrl || active?.sourceImage
  );

  // 远程链过期(403)时：回挂本机主槽。已拆分且仍握有 https 分件链时不要用旧原模主槽顶替。
  useEffect(() => {
    if (!active || active.status !== 'ready') return;
    const primary = pickLocalOrRemoteModelUrl(active, 'current');
    if (primary && (isVaultRef(primary) || primary.startsWith('blob:') || primary.startsWith('data:'))) {
      return;
    }
    if (
      active.segmentTaskId &&
      primary &&
      /^https?:\/\//i.test(primary) &&
      primary !== active.originalModelUrl
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const hit = await findModel3dVaultRefForJob(active);
      if (cancelled || !hit) return;
      // 拆分任务：若命中的是原模槽，不要写进 modelUrl
      if (
        active.segmentTaskId &&
        (hit.endsWith('_orig') || hit.includes('_orig'))
      ) {
        return;
      }
      patchJob(active.id, {
        modelUrl: hit,
        pbrModelUrl: isVaultRef(active.pbrModelUrl) ? active.pbrModelUrl : hit,
        previewHint: '模型已就绪 · 已从本机素材库回挂 · 可拖动环视',
        updatedAt: Date.now(),
      });
      setMsgTone('ok');
      setMsg('已从本机素材库找回 GLB，可预览 / 下载（无需重新生成）');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.status, active?.modelUrl, active?.pbrModelUrl, active?.baseModelUrl]);

  // 拆分结果曾被旧原模冲掉时：用 segmentTaskId 从云端再拉分件网格
  useEffect(() => {
    if (!active || active.status !== 'ready' || !active.segmentTaskId) return;
    const cur = pickLocalOrRemoteModelUrl(active, 'current');
    const orig = pickLocalOrRemoteModelUrl(active, 'original');
    const same =
      !!cur &&
      !!orig &&
      cur === orig;
    const missingCurrent = !cur;
    if (!same && !missingCurrent) return;
    let cancelled = false;
    void (async () => {
      try {
        const tid = (active.segmentTaskId || '').trim();
        if (!tid) return;
        let result =
          active.provider === 'tripo'
            ? await fetchTripoTaskOnce(tid)
            : await fetchQwenTripoTaskOnce(tid);
        if (!result?.modelUrl && active.provider !== 'tripo') {
          result = (await fetchTripoTaskOnce(tid)) || result;
        }
        if (cancelled || !result?.modelUrl) return;
        // 先确保原模进 _orig，再写入分件主槽
        const keepOrig =
          (await preserveOriginalModel3dInVault({
            ...active,
            originalModelUrl: active.originalModelUrl || active.baseModelUrl || cur,
          })) || orig || active.originalModelUrl;
        const vaulted = await persistModel3dJob({
          ...active,
          modelUrl: result.modelUrl,
          pbrModelUrl: result.pbrModelUrl || result.modelUrl,
          originalModelUrl: keepOrig,
          segmentTaskId: tid,
        });
        if (cancelled) return;
        patchJob(active.id, {
          modelUrl: vaulted.modelUrl || result.modelUrl,
          pbrModelUrl: vaulted.pbrModelUrl || result.pbrModelUrl || result.modelUrl,
          originalModelUrl: vaulted.originalModelUrl || keepOrig,
          baseModelUrl: vaulted.baseModelUrl || keepOrig,
          updatedAt: Date.now(),
          previewHint: '分件网格已恢复 · 可切换原模 / 分件着色',
        });
        setMsgTone('ok');
        setMsg('已重新拉回拆分结果；「拆分后整体」应显示分件网格，「原模」显示拆分前');
      } catch {
        /* 云端也可能过期，忽略 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.segmentTaskId, active?.modelUrl, active?.originalModelUrl]);

  return (
    <div className="tp-3d-studio w-full space-y-3 animate-fade-in px-0 sm:px-1">
      <div className="rounded-2xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-slate-50 px-3 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 text-indigo-700 font-black text-[10px] uppercase tracking-widest">
              <Box size={12} /> 3D Studio
            </span>
            <h2 className="text-base font-extrabold text-slate-900">产品设计 · 3D 工作台</h2>
            <div
              className={`text-[10px] font-bold rounded-lg px-2 py-1 border ${
                hydrating
                  ? 'text-slate-600 bg-slate-50 border-slate-200'
                  : provider.ready
                    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : 'text-rose-800 bg-rose-50 border-rose-200'
              }`}
            >
              {hydrating ? '同步中…' : provider.ready ? '生成已就绪' : '需配置 API Key'}
            </div>
            <div
              className={`text-[10px] font-bold rounded-lg px-2 py-1 border ${
                editChannelReady
                  ? 'text-teal-800 bg-teal-50 border-teal-200'
                  : 'text-amber-800 bg-amber-50 border-amber-200'
              }`}
              title="部件拆分 / 重拓扑 / STL 导出依赖编辑通道"
            >
              {editChannelReady
                ? qwenEditReady
                  ? '制造编辑已就绪（主通道）'
                  : '制造编辑已就绪'
                : '制造编辑待配置'}
            </div>
          </div>
          <p className="text-[10px] text-slate-500 font-medium max-w-md text-right leading-snug">
            生成 → 拆分部件 → 补全 → 重拓扑 → 导出 STL/OBJ；拆分与生成共用主通道 Key
          </p>
        </div>
        <div className="mt-1.5">
          <CreativePipelineBar current="3d" onNavigate={onNavigateModule} />
        </div>
      </div>

      {/* 工作台：左侧工具轨 + 参数 | 中预览 | 右项目库 */}
      <div className="tp-3d-workbench">
        <div className="tp-3d-workbench-side space-y-3 max-h-[min(78vh,52rem)] overflow-y-auto custom-scrollbar pr-0.5 min-w-0">
          {/* 制造流水线工具轨 */}
          <div
            ref={workbenchPanelRef}
            className="rounded-2xl border border-slate-200 bg-slate-950 text-white p-2"
          >
            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 px-1.5 mb-1.5 flex items-center gap-1">
              <Wrench size={10} /> 制造工作台
            </div>
            <div className="grid grid-cols-4 gap-1">
              {(
                [
                  { id: 'generate' as const, label: '生成', icon: Sparkles },
                  { id: 'segment' as const, label: '拆分', icon: Scissors },
                  { id: 'complete' as const, label: '补全', icon: Puzzle },
                  { id: 'retopo' as const, label: '重拓扑', icon: Grid3X3 },
                  { id: 'texture' as const, label: '贴图', icon: Paintbrush },
                  { id: 'rig' as const, label: '绑定', icon: Bone },
                  { id: 'export' as const, label: '导出', icon: Printer },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setWorkbenchTool(t.id)}
                  className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[9px] font-black transition ${
                    workbenchTool === t.id
                      ? 'bg-amber-400 text-slate-950 shadow'
                      : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <t.icon size={14} />
                  {t.label}
                </button>
              ))}
            </div>
            {!editChannelReady && workbenchTool !== 'generate' && (
              <div className="mt-2 space-y-1.5 px-1">
                <p className="text-[9px] text-amber-200/90 font-medium leading-relaxed">
                  拆分 / 补全 / 重拓扑等与「生成」共用同一条 3D 主通道 Key。请先在数据接入启用主通道，或下方粘贴 Key。
                </p>
                {isAdmin && (
                  <div className="flex gap-1">
                    <input
                      type="password"
                      value={quickKey}
                      onChange={(e) => setQuickKey(e.target.value)}
                      placeholder="粘贴 3D 主通道 Key"
                      className="flex-1 rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-[10px] text-white placeholder:text-slate-500"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      disabled={savingKey}
                      onClick={() => void saveQuickKey()}
                      className="rounded-lg bg-amber-400 text-slate-950 text-[9px] font-black px-2 disabled:opacity-50"
                    >
                      保存
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {workbenchTool !== 'generate' && active?.status === 'ready' && (
            <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-3 space-y-2.5">
              {workbenchTool === 'segment' && (
                <>
                  <div className="text-xs font-black text-teal-900 flex items-center gap-1">
                    <Scissors size={13} /> 部件拆分
                  </div>
                  <p className="text-[10px] text-teal-800/80 font-medium leading-relaxed">
                    按几何自动拆成可打印 / 开模部件。建议粗略 3–6、标准 8–15、精细 15+ 件。
                  </p>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        { id: 'simple' as const, label: '粗略', tip: '3–6' },
                        { id: 'balanced' as const, label: '标准', tip: '8–15' },
                        { id: 'detailed' as const, label: '精细', tip: '15+' },
                      ] as const
                    ).map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setSegmentGranularity(g.id)}
                        className={`rounded-lg border px-1.5 py-1.5 text-center ${
                          segmentGranularity === g.id
                            ? 'border-teal-500 bg-white text-teal-900'
                            : 'border-teal-100 bg-white/50 text-teal-700'
                        }`}
                      >
                        <div className="text-[10px] font-black">{g.label}</div>
                        <div className="text-[8px] font-bold opacity-70">{g.tip}</div>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={busy || !editChannelReady}
                    onClick={() => void runPostProcess('segment')}
                    className="w-full rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black py-2.5 disabled:opacity-50"
                  >
                    {busy ? '拆分中…' : hasSegmentResult ? '重新拆分' : '开始拆分'}
                  </button>
                  {hasSegmentResult && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewMode('parts');
                          setMsgTone('ok');
                          setMsg('分件着色：拖拽旋转，底部调节炸开');
                        }}
                        className="rounded-xl border border-teal-300 bg-white text-teal-900 text-[11px] font-black py-2"
                      >
                        看拆分效果
                      </button>
                      <button
                        type="button"
                        disabled={recoveringOriginal}
                        onClick={() => showOriginalModel()}
                        className="rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-900 text-[11px] font-black py-2 disabled:opacity-50"
                      >
                        {recoveringOriginal ? '本机查找…' : '看原模'}
                      </button>
                    </div>
                  )}
                </>
              )}
              {workbenchTool === 'complete' && (
                <>
                  <div className="text-xs font-black text-teal-900 flex items-center gap-1">
                    <Puzzle size={13} /> 部件补全
                  </div>
                  <p className="text-[10px] text-teal-800/80 font-medium leading-relaxed">
                    对已拆分部件补封闭面，便于单独 3D 打印与模具分件。须先完成拆分。
                  </p>
                  <button
                    type="button"
                    disabled={busy || !editChannelReady || !active.segmentTaskId}
                    onClick={() => void runPostProcess('complete')}
                    className="w-full rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black py-2.5 disabled:opacity-50"
                  >
                    {busy ? '补全中…' : '开始补全'}
                  </button>
                </>
              )}
              {workbenchTool === 'retopo' && (
                <>
                  <div className="text-xs font-black text-teal-900 flex items-center gap-1">
                    <Grid3X3 size={13} /> 重拓扑
                  </div>
                  <p className="text-[10px] text-teal-800/80 font-medium leading-relaxed">
                    降面并整理拓扑。四边面利于模具/细分；三角面利于打印与引擎。打印建议 5k–20k 面。
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => setRetopoQuad(true)}
                      className={`rounded-lg border px-2 py-1.5 text-[10px] font-black ${
                        retopoQuad ? 'border-teal-500 bg-white' : 'border-teal-100 bg-white/40'
                      }`}
                    >
                      四边面
                    </button>
                    <button
                      type="button"
                      onClick={() => setRetopoQuad(false)}
                      className={`rounded-lg border px-2 py-1.5 text-[10px] font-black ${
                        !retopoQuad ? 'border-teal-500 bg-white' : 'border-teal-100 bg-white/40'
                      }`}
                    >
                      三角面
                    </button>
                  </div>
                  <label className="block text-[9px] font-black text-teal-700 uppercase tracking-wider">
                    目标面数 {retopoFaceLimit.toLocaleString()}
                  </label>
                  <input
                    type="range"
                    min={500}
                    max={50000}
                    step={500}
                    value={retopoFaceLimit}
                    onChange={(e) => setRetopoFaceLimit(Number(e.target.value))}
                    className="w-full accent-teal-600"
                  />
                  <button
                    type="button"
                    disabled={busy || !editChannelReady}
                    onClick={() => void runPostProcess('retopo')}
                    className="w-full rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black py-2.5 disabled:opacity-50"
                  >
                    {busy ? '重拓扑中…' : '开始重拓扑'}
                  </button>
                </>
              )}
              {workbenchTool === 'texture' && (
                <>
                  <div className="text-xs font-black text-teal-900 flex items-center gap-1">
                    <Paintbrush size={13} /> 高清贴图
                  </div>
                  <p className="text-[10px] text-teal-800/80 font-medium leading-relaxed">
                    对当前网格重做 PBR 贴图。可用上方「描述」作贴图提示。高模请先重拓扑再贴图更稳。
                  </p>
                  <button
                    type="button"
                    disabled={busy || !editChannelReady}
                    onClick={() => void runPostProcess('texture_hd')}
                    className="w-full rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black py-2.5 disabled:opacity-50"
                  >
                    {busy ? '贴图中…' : '生成贴图'}
                  </button>
                </>
              )}
              {workbenchTool === 'rig' && (
                <>
                  <div className="text-xs font-black text-teal-900 flex items-center gap-1">
                    <Bone size={13} /> 自动绑定
                  </div>
                  <p className="text-[10px] text-teal-800/80 font-medium leading-relaxed">
                    为人形/生物模型加骨骼，便于演示动画。开模打印请优先拆分与导出，不必绑定。
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {(
                      [
                        { id: 'biped' as const, label: '人形' },
                        { id: 'quadruped' as const, label: '四足' },
                      ] as const
                    ).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setRigType(r.id)}
                        className={`rounded-lg border px-2 py-1.5 text-[10px] font-black ${
                          rigType === r.id ? 'border-teal-500 bg-white' : 'border-teal-100 bg-white/40'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={busy || !editChannelReady}
                    onClick={() => void runPostProcess('rig')}
                    className="w-full rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black py-2.5 disabled:opacity-50"
                  >
                    {busy ? '绑定中…' : '自动绑定'}
                  </button>
                </>
              )}
              {workbenchTool === 'export' && (
                <>
                  <div className="text-xs font-black text-teal-900 flex items-center gap-1">
                    <Printer size={13} /> 制造导出
                  </div>
                  <p className="text-[10px] text-teal-800/80 font-medium leading-relaxed">
                    STL / 3MF 适合 3D 打印与手板；OBJ / FBX 适合模具 CAD。建议拆分+重拓扑后再导出。
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['STL', '3MF', 'OBJ', 'FBX', 'GLTF', 'USDZ'] as TripoConvertFormat[]).map(
                      (fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          disabled={busy || !editChannelReady}
                          onClick={() => void runPostProcess('convert', fmt)}
                          className="rounded-lg bg-teal-700/90 hover:bg-teal-600 text-white text-[10px] font-black px-2.5 py-1.5 disabled:opacity-50"
                        >
                          转 {fmt}
                        </button>
                      )
                    )}
                  </div>
                </>
              )}
              {!!active.meshOps?.length && (
                <div className="pt-1 border-t border-teal-100">
                  <div className="text-[9px] font-black text-teal-700 uppercase tracking-wider mb-1">
                    已完成步骤
                  </div>
                  <ul className="space-y-0.5 max-h-20 overflow-y-auto">
                    {[...active.meshOps].reverse().slice(0, 6).map((op, i) => (
                      <li key={`${op.at}-${i}`} className="text-[9px] font-bold text-teal-800/80">
                        {op.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {workbenchTool !== 'generate' && (!active || active.status !== 'ready') && (
            <div className="rounded-2xl border border-slate-200 bg-white p-3 text-[11px] text-slate-500 font-medium">
              请先在「生成」完成模型，再使用拆分 / 重拓扑 / 制造导出。
            </div>
          )}

          {workbenchTool === 'generate' && !provider.ready && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 space-y-2">
              <div className="text-xs font-black text-rose-900 flex items-center gap-1.5">
                <KeyRound size={14} /> 尚未配置图生 3D API
              </div>
              <p className="text-[11px] text-rose-800/90 font-medium leading-relaxed">
                未配置 Key 时点击「生成」不会创建任务。请在「数据接入」配置图生 3D 主通道 Key（管理员也可在下方快捷粘贴）。
              </p>
              {isAdmin && (
                <div className="space-y-2 pt-1">
                  <label className="text-[10px] font-black text-rose-700 uppercase tracking-wider">
                    管理员快捷配置
                  </label>
                  <input
                    type="password"
                    value={quickKey}
                    onChange={(e) => setQuickKey(e.target.value)}
                    placeholder="粘贴图生 3D API Key"
                    className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    disabled={savingKey}
                    onClick={() => void saveQuickKey()}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-black py-2.5 disabled:opacity-60"
                  >
                    {savingKey ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    保存并启用
                  </button>
                </div>
              )}
            </div>
          )}
          {workbenchTool === 'generate' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex gap-2">
              {(
                [
                  { id: 'image' as const, label: '图生 3D', icon: Upload },
                  { id: 'text' as const, label: '文生 3D', icon: Type },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-black py-2.5 border ${
                    mode === m.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  <m.icon size={14} /> {m.label}
                </button>
              ))}
            </div>

            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <Sparkles size={12} /> Skills
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar">
                {MODEL3D_SKILLS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setModelSkillId(s.id);
                      if (s.defaultPrompt) setPrompt(s.defaultPrompt);
                      setNegativePrompt(s.negativeHints || '');
                      setQuality(s.qualityHint);
                      setTextureQuality(
                        s.qualityHint === 'engine_ready' ? 'standard' : 'detailed'
                      );
                    }}
                    className={`w-full text-left rounded-xl border px-2.5 py-2 ${
                      modelSkillId === s.id
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-slate-100 hover:border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-xs font-black text-slate-800">{s.label}</span>
                      <span className="text-[9px] font-bold text-indigo-600/80">{s.category}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium mt-0.5">{s.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            {mode === 'image' ? (
              <div className="space-y-2">
                <CreativeRefPicker
                  value={sourceImages}
                  onChange={setSourceImages}
                  multiple
                  max={4}
                  accent="indigo"
                  title="从平面设计 / 产品库多选（最多 4 张，建议正面·侧面·背面）"
                  onSkuMeta={(meta) => {
                    if (meta?.skuCode) setSkuPick(meta.skuCode);
                    setSkuName(meta?.skuName);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full min-h-[100px] rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 flex flex-col items-center justify-center gap-2 text-indigo-800"
                >
                  <Upload size={22} />
                  <span className="text-xs font-black">
                    或本地上传（可多选）· 已选 {sourceImages.length}/4
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      onPickImages(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </button>
                <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                  多选 2～4 张按「前 → 左 → 后 → 右」多视图重建（几何更准）；单张走图生并自动修图。
                </p>
              </div>
            ) : null}

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                描述 / 补充提示
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="如：玩具车，圆润边角，保留包装比例…"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-y"
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  负向约束（不想出现的）
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setNegativePrompt(
                      (MODEL3D_SKILLS.find((s) => s.id === modelSkillId) || MODEL3D_SKILLS[0])
                        .negativeHints || ''
                    )
                  }
                  className="text-[9px] font-bold text-indigo-600 hover:text-indigo-800"
                >
                  恢复 Skill 默认
                </button>
              </div>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={2}
                placeholder="如：破面、多余肢体、漂浮杂件…"
                className="mt-1 w-full rounded-xl border border-rose-100 bg-rose-50/40 px-3 py-2 text-xs font-medium text-slate-700 resize-y"
              />
              <p className="text-[9px] text-slate-400 font-medium mt-1">
                可编辑；生成时仍合并通用 3D 拒绝项。
              </p>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">网格品质</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setQuality('high_detail');
                    if (textureQuality === 'standard') setTextureQuality('detailed');
                  }}
                  className={`rounded-xl border p-3 text-left ${
                    quality === 'high_detail' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'
                  }`}
                >
                  <div className="text-xs font-black text-slate-800 flex items-center gap-1">
                    <Sparkles size={12} /> 高细节
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1 font-medium">超清几何 · PBR · 高保真</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuality('engine_ready');
                    setTextureQuality('standard');
                  }}
                  className={`rounded-xl border p-3 text-left ${
                    quality === 'engine_ready' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'
                  }`}
                >
                  <div className="text-xs font-black text-slate-800 flex items-center gap-1">
                    <Layers size={12} /> 引擎就绪
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1 font-medium">智能低模 · ≤2 万面</p>
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                贴图质量
              </label>
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'standard' as const, label: '标清', hint: '更快' },
                    { id: 'detailed' as const, label: '高清', hint: '推荐' },
                    { id: 'extreme' as const, label: '极致', hint: '8K' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTextureQuality(t.id)}
                    className={`rounded-xl border px-2 py-2 text-center ${
                      textureQuality === t.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="text-[11px] font-black text-slate-800">{t.label}</div>
                    <div className="text-[9px] text-slate-500 font-medium mt-0.5">{t.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              {mode === 'image' && (
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alignImage}
                    onChange={(e) => setAlignImage(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span className="text-[11px] font-bold text-slate-700">对齐参考图朝向</span>
                </label>
              )}
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSize}
                  onChange={(e) => setAutoSize(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                <span className="text-[11px] font-bold text-slate-700">真实世界尺寸（米，适合 AR/引擎）</span>
              </label>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Package size={10} /> 挂接产品库（可选）
              </label>
              <select
                value={skuPick}
                onChange={(e) => {
                  const id = e.target.value;
                  setSkuPick(id);
                  const s = skus.find((x) => x.id === id);
                  if (s?.images?.length && mode === 'image') {
                    setSourceImages(s.images.filter(Boolean).slice(0, 4));
                  }
                }}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">不挂接</option>
                {skus.slice(0, 80).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.skuCode} · {s.name}
                    {s.images?.length ? ' · 有图' : ''}
                  </option>
                ))}
              </select>
              {skuPick && skus.find((s) => s.id === skuPick)?.images?.[0] ? (
                <p className="text-[10px] font-bold text-indigo-700 mt-1">
                  已带入产品库图片（可多选），可直接图生 3D 或增删参考
                </p>
              ) : null}
            </div>

            <button
              type="button"
              disabled={busy || hydrating}
              onClick={() => void runGenerate()}
              className={`w-full rounded-xl text-white text-sm font-black py-3 disabled:opacity-50 inline-flex items-center justify-center gap-2 ${
                provider.ready
                  ? 'bg-indigo-600 hover:bg-indigo-700'
                  : 'bg-slate-700 hover:bg-slate-800'
              }`}
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <Box size={16} />}
              {busy
                ? `生成中… ${active?.progress ?? 0}%`
                : provider.ready
                  ? '生成 3D 模型'
                  : '生成 3D 模型（需先配置 Key）'}
            </button>

            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 space-y-2">
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                本地 GLB · 预览 / 3D 打印
              </div>
              <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                已有模型可直接导入环视预览；下载 GLB 后用切片软件（如 Cura）做 3D 打印，无需再次生成。
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => glbFileRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-800 text-xs font-black py-2.5 disabled:opacity-50"
              >
                <Upload size={14} /> 导入本地 GLB / GLTF
              </button>
              <input
                ref={glbFileRef}
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                className="hidden"
                onChange={(e) => {
                  void onPickGlb(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            {msg && (
              <p
                className={`text-xs font-bold rounded-xl px-3 py-2 border ${
                  msgTone === 'error'
                    ? 'text-rose-900 bg-rose-50 border-rose-200'
                    : msgTone === 'ok'
                      ? 'text-emerald-900 bg-emerald-50 border-emerald-200'
                      : 'text-indigo-900 bg-indigo-50 border-indigo-100'
                }`}
              >
                {msg}
              </p>
            )}
          </div>
          )}

          {msg && workbenchTool !== 'generate' && (
            <p
              className={`text-xs font-bold rounded-xl px-3 py-2 border ${
                msgTone === 'error'
                  ? 'text-rose-900 bg-rose-50 border-rose-200'
                  : msgTone === 'ok'
                    ? 'text-emerald-900 bg-emerald-50 border-emerald-200'
                    : 'text-indigo-900 bg-indigo-50 border-indigo-100'
              }`}
            >
              {msg}
            </p>
          )}
        </div>

        <div className="tp-3d-workbench-stage min-w-0 rounded-2xl border border-slate-200 bg-slate-950 text-white overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-300">
            <span>
              {active?.status === 'ready' && (rawDownloadUrl || downloadUrl)
                ? previewMode === 'parts' && hasSegmentResult
                  ? '拆分效果 · 分件着色'
                  : previewMode === 'original' &&
                      !!(active.originalModelUrl || active.baseModelUrl)
                    ? '原模环视（拆分前）'
                    : '3D 环视预览 · 可拖转'
                : '视口预览'}
            </span>
            <CreativeStorageBadge compact className="!bg-white/10 !border-white/20 !text-slate-200" />
            {active && (
              <span className="uppercase tracking-wider text-[10px] text-indigo-300">
                {active.status}
                {typeof active.progress === 'number' && active.status === 'running'
                  ? ` · ${active.progress}%`
                  : ''}{' '}
                · {active.quality === 'high_detail' ? '高细节' : '引擎就绪'}
              </span>
            )}
          </div>
          <div className="relative w-full h-[min(70vh,42rem)] min-h-[22rem] flex items-stretch justify-center">
            {active?.status === 'running' ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-3 p-6">
                <Loader2 className="mx-auto animate-spin text-indigo-400" size={36} />
                <p className="text-sm font-bold text-slate-300">
                  {(active.previewHint || '').includes('upload') || (active.progress ?? 0) < 12
                    ? '正在上传参考图并重建网格…'
                    : (active.progress ?? 0) >= 100
                      ? '云端已完成，正在准备预览…'
                      : '正在重建网格…'}
                </p>
                <div className="w-48 h-1.5 rounded-full bg-white/10 mx-auto overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{ width: `${active.progress ?? 5}%` }}
                  />
                </div>
              </div>
            ) : active?.status === 'ready' && (rawPreviewUrl || rawDownloadUrl) ? (
              previewMode === 'parts' && hasSegmentResult ? (
                <Suspense
                  fallback={
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400">
                      <Loader2 className="animate-spin text-indigo-400" size={28} />
                      <span className="text-xs font-bold">分件预览加载中…</span>
                    </div>
                  }
                >
                  <Model3dPartsViewer
                    key={`parts-${active.id}-${active.segmentTaskId || active.providerTaskId || ''}`}
                    src={(
                      pickLocalOrRemoteModelUrl(active, 'current') ||
                      rawPreviewUrl ||
                      rawDownloadUrl ||
                      ''
                    ).trim()}
                    className="w-full h-full min-h-0"
                    explode={0.08}
                    onPartsFound={(names) => {
                      setPartNames((prev) =>
                        prev.length === names.length && prev.every((n, i) => n === names[i])
                          ? prev
                          : names
                      );
                      // 拆分「成功」但网格仍是一整块：明确提示，避免误以为炸开坏了
                      if (names.length < 2) {
                        setMsgTone('error');
                        setMsg(
                          '分件网格仍是 1 块，炸开不会散开。请点「重新拆分」并选「精细」；须挂首次生成任务（勿清素材）。'
                        );
                      } else {
                        setMsgTone('ok');
                        setMsg(
                          `部件预览：共 ${names.length} 件。默认轻炸开并保留贴图；拖「炸开」可拉开，点「原模」看拆分前彩色成片`
                        );
                      }
                    }}
                  />
                </Suspense>
              ) : (
              <Model3dOrbitViewer
                // 直接传 vault:/https，由预览组件本机秒开；勿等 useVaultUrl 异步，否则会空转半小时
                src={(rawPreviewUrl || rawDownloadUrl || '').trim()}
                // 勿把 updatedAt / 签名 URL 查询串塞进 stableKey：否则 patchJob 或换签会反复卸载本机预览
                stableKey={`${active.id}|${previewMode}|${active.segmentTaskId || ''}|${
                  (() => {
                    const u = (rawPreviewUrl || rawDownloadUrl || '').trim();
                    if (!u) return 'empty';
                    if (isVaultRef(u) || u.startsWith('blob:') || u.startsWith('data:')) return u;
                    return active.providerTaskId || 'remote';
                  })()
                }`}
                poster={previewPoster || undefined}
                className="w-full h-full min-h-0"
                downloadHref={downloadUrl || previewUrl || undefined}
                onRemoteExpired={() => {
                  if (!active) return;
                  void findModel3dVaultRefForJob(active).then((hit) => {
                    if (!hit) {
                      setMsgTone('error');
                      setMsg(
                        '远程链已过期，且本机未匹配到该任务的 GLB。请用「导入本地 GLB」或重新生成。'
                      );
                      return;
                    }
                    patchJob(active.id, {
                      modelUrl: hit,
                      pbrModelUrl: isVaultRef(active.pbrModelUrl) ? active.pbrModelUrl : hit,
                      previewHint: '模型已就绪 · 已从本机素材库回挂 · 可拖动环视',
                      updatedAt: Date.now(),
                    });
                    // 原模远程过期时切到当前本机 GLB，避免一直卡在失败预览
                    setPreviewMode('current');
                    setMsgTone('ok');
                    setMsg('远程链已过期，已切到本机 GLB，可预览 / 下载');
                  });
                }}
                onLocalBlob={(blob) => {
                  if (!activeId) return;
                  if (
                    isVaultRef(active?.modelUrl) ||
                    isVaultRef(active?.pbrModelUrl) ||
                    isVaultRef(active?.baseModelUrl)
                  ) {
                    return;
                  }
                  void (async () => {
                    try {
                      const vaultRef = await putBlobInVault({
                        blob,
                        kind: 'model3d',
                        id: model3dVaultIdForJob(activeId),
                        sourceHint: active?.providerTaskId || activeId,
                        mime: blob.type || 'model/gltf-binary',
                      });
                      patchJob(activeId, {
                        modelUrl: vaultRef,
                        pbrModelUrl: active?.pbrModelUrl?.startsWith('http')
                          ? vaultRef
                          : active?.pbrModelUrl,
                        previewHint: '模型已就绪 · 已存本机 · 可拖动环视',
                      });
                      setMsgTone('ok');
                      setMsg('3D 已写入本机素材库，刷新后仍可预览；也可下载 GLB');
                    } catch (e) {
                      console.warn('[3d] vault from preview blob failed', e);
                    }
                  })();
                }}
              />
              )
            ) : active?.previewImageUrl ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6">
                <VaultImg
                  src={active.previewImageUrl}
                  alt=""
                  className="max-h-72 rounded-2xl shadow-2xl shadow-indigo-500/20 object-contain"
                />
                <p className="text-[10px] font-bold text-amber-200/90">
                  尚未找到可环视的 3D 文件，正在显示预览图。请点「导入本地 GLB」或重新生成。
                </p>
              </div>
            ) : active?.sourceImage ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="relative">
                  <VaultImg
                    src={active.sourceImage}
                    alt=""
                    className="relative max-h-64 rounded-2xl object-contain opacity-80"
                  />
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-black bg-indigo-500/90 px-2 py-1 rounded-lg whitespace-nowrap">
                    参考图
                  </div>
                </div>
              </div>
            ) : active ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-2 px-4">
                <p className="text-sm font-bold text-slate-300">{active.title}</p>
                <p className="text-xs text-slate-500">{active.error || active.previewHint}</p>
              </div>
            ) : (
              <p className="flex-1 flex items-center justify-center text-sm text-slate-500 font-medium">
                从左侧创建任务后在此预览；生成完成后可拖动旋转查看
              </p>
            )}
          </div>
          {active?.status === 'ready' && (rawDownloadUrl || downloadUrl) && (
            <div className="px-4 py-3 border-t border-white/10 space-y-2">
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      try {
                        const { downloadMediaFile } = await import('../services/creativeAssetVault');
                        await downloadMediaFile(
                          rawDownloadUrl || downloadUrl,
                          `${(active.title || 'model').replace(/\s+/g, '_')}.glb`
                        );
                      } catch (e: any) {
                        window.alert(e?.message || 'GLB 下载失败');
                      }
                    })();
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[11px] font-black px-3 py-2.5 text-white shadow-lg shadow-emerald-500/30"
                >
                  <Download size={12} /> 下载 GLB
                </button>
                {active.previewImageUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          const { downloadMediaFile } = await import('../services/creativeAssetVault');
                          await downloadMediaFile(
                            active.previewImageUrl,
                            `${(active.title || 'model').replace(/\s+/g, '_')}-preview`
                          );
                        } catch (e: any) {
                          window.alert(e?.message || '预览图下载失败');
                        }
                      })();
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] font-black px-3 py-2"
                  >
                    <Download size={12} /> 平面渲染图
                  </button>
                )}
                {active.modelVersion && (
                  <span className="text-[9px] font-bold text-slate-500">
                    {active.quality === 'engine_ready' ? '引擎就绪' : '高细节'} · 已生成
                  </span>
                )}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[10px] font-black text-teal-200/90 uppercase tracking-wider">
                    制造快捷
                  </div>
                  <button
                    type="button"
                    onClick={() => openSegmentWorkbench({ viewParts: true })}
                    className="text-[9px] font-black text-amber-300 hover:text-amber-200"
                  >
                    {hasSegmentResult ? '查看拆分效果 →' : '打开拆分工作台 →'}
                  </button>
                </div>
                {hasSegmentResult && (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewMode('parts');
                        setMsgTone('ok');
                        setMsg('分件着色：拖拽旋转 / 滚轮缩放，底部调节炸开');
                      }}
                      className={`rounded-lg text-[10px] font-black px-2.5 py-1.5 ${
                        previewMode === 'parts'
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-white/10 hover:bg-white/15'
                      }`}
                    >
                      分件着色
                    </button>
                    <button
                      type="button"
                      disabled={recoveringOriginal}
                      onClick={() => showOriginalModel()}
                      className={`rounded-lg text-[10px] font-black px-2.5 py-1.5 ${
                        previewMode === 'original'
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-white/10 hover:bg-white/15'
                      } disabled:opacity-50`}
                    >
                      {recoveringOriginal ? '本机查找…' : '原模（本机）'}
                    </button>
                    <button
                      type="button"
                      disabled={recoveringOriginal}
                      onClick={() => {
                        if (
                          !window.confirm(
                            '仅在本机彩色原模丢失时使用。将访问云端任务链，可能消耗额度。确定补拉？'
                          )
                        ) {
                          return;
                        }
                        void recoverOriginalModel({ forceCloudTextured: true });
                      }}
                      className="rounded-lg text-[10px] font-black px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-50"
                      title="本机没有彩色原模时才用；会访问云端"
                    >
                      云端补拉
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const url = pickLocalOrRemoteModelUrl(active, 'current');
                        const orig = pickLocalOrRemoteModelUrl(active, 'original');
                        setPreviewMode('current');
                        if (!url) {
                          setMsgTone('error');
                          setMsg('分件网格暂不可用，请稍候自动恢复或重新点「部件拆分」');
                          return;
                        }
                        if (orig && url === orig) {
                          setMsgTone('info');
                          setMsg(
                            '当前分件链与原模相同（历史数据可能被冲掉），正在尝试按拆分任务重新拉取…'
                          );
                          return;
                        }
                        setMsgTone('info');
                        setMsg('拆分后整体环视（未着色的分件网格，不是拆分前原模）');
                      }}
                      className={`rounded-lg text-[10px] font-black px-2.5 py-1.5 ${
                        previewMode === 'current'
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-white/10 hover:bg-white/15'
                      }`}
                    >
                      拆分后整体
                    </button>
                    <label className="rounded-lg bg-white/10 hover:bg-white/15 text-[10px] font-black px-2.5 py-1.5 cursor-pointer inline-flex items-center gap-1">
                      <Upload size={10} /> 设为当前任务原模
                      <input
                        type="file"
                        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                        className="hidden"
                        onChange={(e) => {
                          void onAttachOriginalGlb(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {partNames.length > 0 && (
                      <span className="text-[9px] font-bold text-teal-200/80 self-center">
                        {partNames.length} 个部件
                      </span>
                    )}
                    <span className="text-[9px] text-slate-400 font-medium self-center basis-full">
                      勿清空本机素材。左侧「导入本地 GLB」会新建任务；要用「设为当前任务原模」才不会丢分件。
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busy || !editChannelReady}
                    onClick={() => {
                      setWorkbenchTool('segment');
                      void runPostProcess('segment');
                    }}
                    className="rounded-lg bg-amber-400/90 hover:bg-amber-300 text-[10px] font-black px-2.5 py-1.5 text-slate-950 disabled:opacity-50"
                  >
                    部件拆分
                  </button>
                  <button
                    type="button"
                    disabled={busy || !editChannelReady}
                    onClick={() => {
                      setWorkbenchTool('retopo');
                      void runPostProcess('retopo');
                    }}
                    className="rounded-lg bg-white/10 hover:bg-white/15 text-[10px] font-black px-2.5 py-1.5 disabled:opacity-50"
                  >
                    重拓扑
                  </button>
                  <button
                    type="button"
                    disabled={busy || !editChannelReady}
                    onClick={() => {
                      setWorkbenchTool('export');
                      void runPostProcess('convert', 'STL');
                    }}
                    className="rounded-lg bg-emerald-500/80 hover:bg-emerald-400 text-[10px] font-black px-2.5 py-1.5 text-slate-950 disabled:opacity-50"
                  >
                    导出 STL（打印）
                  </button>
                  <button
                    type="button"
                    disabled={busy || !editChannelReady}
                    onClick={() => {
                      setWorkbenchTool('export');
                      void runPostProcess('convert', 'OBJ');
                    }}
                    className="rounded-lg bg-white/10 hover:bg-white/15 text-[10px] font-black px-2.5 py-1.5 disabled:opacity-50"
                  >
                    导出 OBJ（模具）
                  </button>
                </div>
                {active.convertedUrls && Object.keys(active.convertedUrls).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(Object.entries(active.convertedUrls) as [TripoConvertFormat, string][]).map(
                      ([fmt, url]) =>
                        url ? (
                          <a
                            key={fmt}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            download
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 text-emerald-200 text-[10px] font-black px-2 py-1"
                          >
                            <Download size={10} /> {fmt}
                          </a>
                        ) : null
                    )}
                  </div>
                )}
                {!editChannelReady && (
                  <p className="text-[9px] text-amber-200/80 font-medium leading-relaxed">
                    请先启用 3D 主通道（与生成同一条 Key），即可拆分部件并导出打印/开模格式。
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="tp-3d-workbench-library min-w-0 rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col min-h-[22rem]">
          <div className="px-3 py-2.5 border-b border-slate-100 text-xs font-black text-slate-700">
            项目库 ({jobs.length})
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {[...jobs]
              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
              .map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => setActiveId(j.id)}
                className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 ${
                  activeId === j.id ? 'bg-indigo-50' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-black text-slate-800 truncate">{j.title}</div>
                    <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                      {j.mode === 'image' ? '图生' : '文生'} · {j.status}
                      {j.modelUrl ? ' · GLB' : ''}
                    </div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeJob(j.id);
                    }}
                    className="text-slate-300 hover:text-rose-500 p-0.5"
                  >
                    <Trash2 size={12} />
                  </span>
                </div>
              </button>
            ))}
            {!jobs.length && (
              <p className="text-center text-xs text-slate-400 py-8 font-medium">暂无任务</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
