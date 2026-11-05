import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { getQwenTripo3dProviderStatus } from '../services/qwenTripo3dService';
import { loadDataProviderLocal, saveDataProvider } from '../services/dataProviders';
import { consumeCreativeHandoff } from '../services/creativeAssetBridge';
import { persistModel3dJob, purgeDeletedCreativeMedia } from '../services/creativeAssetPersist';
import {
  findModel3dVaultRefForJob,
  isVaultRef,
  model3dVaultIdForJob,
  putBlobInVault,
  tryPersistMediaUrl,
} from '../services/creativeAssetVault';
import { CreativePipelineBar, CreativeRefPicker } from './CreativeRefPicker';
import { MODEL3D_SKILLS, type Model3dSkillId } from '../services/creativeSkills/model3dSkills';
import { UNIVERSAL_3D_NEGATIVES, mergeNegatives } from '../services/creativeQualityKit';
import { Model3dOrbitViewer } from './Model3dOrbitViewer';
import { Model3dPartsViewer } from './Model3dPartsViewer';
import { CreativeStorageBadge } from './CreativeStorageBadge';
import { VaultImg, useVaultUrl } from './VaultMedia';

type Props = {
  currentUser: User;
  onNavigateModule?: (mod: ModuleType) => void;
};

/**
 * 产品设计 · 3D：图/文生 3D、品质档、真实 GLB 导出。
 */
export const ModuleProductDesign3D: React.FC<Props> = ({ currentUser, onNavigateModule }) => {
  const [jobs, setJobs] = useState<Model3dJob[]>(() => sanitizeModel3dJobs(loadModel3dJobs()));
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
  const [activeId, setActiveId] = useState<string | null>(() => {
    const initial = sanitizeModel3dJobs(loadModel3dJobs());
    return initial[0]?.id || null;
  });
  const [provider, setProvider] = useState(() => getModel3dProviderStatus());
  const [hydrating, setHydrating] = useState(true);
  const [quickKey, setQuickKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  /** 制造工作台当前工具 */
  const [workbenchTool, setWorkbenchTool] = useState<Model3dWorkbenchTool>('generate');
  const [segmentGranularity, setSegmentGranularity] =
    useState<TripoSegmentGranularity>('balanced');
  const [retopoFaceLimit, setRetopoFaceLimit] = useState(8000);
  const [retopoQuad, setRetopoQuad] = useState(true);
  const [rigType, setRigType] = useState<TripoRigType>('biped');
  /** 拆分后：部件着色 + 炸开预览 */
  const [partsPreview, setPartsPreview] = useState(false);
  const [partNames, setPartNames] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const glbFileRef = useRef<HTMLInputElement>(null);
  const workbenchPanelRef = useRef<HTMLDivElement>(null);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const active = jobs.find((j) => j.id === activeId) || null;
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'director';
  /** 千问主通道或官方编辑通道任一即可做拆分/重拓扑等 */
  const editChannelReady = isModel3dEditReady();
  const qwenEditReady = getQwenTripo3dProviderStatus().ready;
  const hasSegmentResult = !!(active?.segmentTaskId || active?.meshOps?.some((o) => o.kind === 'segment'));

  const openSegmentWorkbench = (opts?: { viewParts?: boolean }) => {
    setWorkbenchTool('segment');
    if (opts?.viewParts !== false && hasSegmentResult) {
      setPartsPreview(true);
      setMsgTone('ok');
      setMsg(
        partNames.length
          ? `部件预览已打开：共 ${partNames.length} 件，不同颜色区分；可拖动下方「炸开」查看分件`
          : '部件预览已打开：不同颜色区分各部件，可拖动下方「炸开」查看分件'
      );
    }
    requestAnimationFrame(() => {
      workbenchPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  // 切换任务时：有拆分记录则默认看部件预览
  useEffect(() => {
    if (!active) {
      setPartsPreview(false);
      setPartNames([]);
      return;
    }
    if (active.segmentTaskId) setPartsPreview(true);
    else setPartsPreview(false);
    setPartNames([]);
  }, [active?.id, active?.segmentTaskId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHydrating(true);
      // 先清僵尸 running@100%，立刻可操作，再异步恢复/落库
      const cleaned = sanitizeModel3dJobs(loadModel3dJobs());
      saveModel3dJobs(cleaned);
      setJobs(cleaned);
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
          setActiveId(revived[0].id);
        }

        // 仅对仍是远程链的 ready 任务后台落库；已 vault/blob 的跳过，避免进模块就串行重下
        void (async () => {
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

      if (qwenEditReady) {
        if (kind === 'complete') {
          upstreamId = (active.segmentTaskId || '').trim();
        } else if (
          active.provider === 'qwen_tripo' ||
          (active.providerTaskId && !active.officialTaskId)
        ) {
          upstreamId = (
            active.providerTaskId ||
            active.sourceTaskId ||
            active.segmentTaskId ||
            ''
          ).trim();
        } else {
          upstreamId = (
            active.providerTaskId ||
            active.sourceTaskId ||
            active.segmentTaskId ||
            ''
          ).trim();
        }
        const cand = [active.modelUrl, active.pbrModelUrl, active.baseModelUrl, modelUrl].find(
          (u) => u && /^https?:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u)
        );
        publicModelUrl = cand;
        if (!upstreamId && !publicModelUrl && !isTripoOfficialReady()) {
          throw new Error(
            '当前模型没有云端任务 ID 或公网地址。请用主通道重新生成后再拆分，或导入后先用带 https 链的结果。'
          );
        }
      } else {
        const officialId = await ensureOfficialModelTaskId({
          provider: active.provider,
          providerTaskId: active.providerTaskId,
          officialTaskId: active.officialTaskId,
          modelUrl,
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
            : (active.provider === 'tripo'
                ? active.providerTaskId || officialId
                : officialId
              ).trim();
      }

      const result = await runTripoPostProcess({
        kind,
        originalTaskId: upstreamId || undefined,
        modelUrl: publicModelUrl,
        format,
        texturePrompt: prompt.trim() || undefined,
        faceLimit: retopoFaceLimit,
        quad: retopoQuad,
        segmentGranularity,
        rigType,
        preferOfficial: !qwenEditReady,
        onTaskCreated: (tid) =>
          patchJob(active.id, {
            providerTaskId: tid,
            ...(qwenEditReady ? {} : { officialTaskId: tid }),
          }),
        onProgress: (pct, status) => {
          patchJob(active.id, {
            status: 'running',
            progress: Math.round(qwenEditReady ? pct : 35 + pct * 0.65),
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
      const next: Partial<Model3dJob> = {
        status: 'ready',
        progress: 100,
        provider: result.provider || active.provider,
        providerTaskId: result.taskId,
        officialTaskId: qwenEditReady
          ? active.officialTaskId
          : result.taskId || active.officialTaskId,
        sourceTaskId:
          active.sourceTaskId || active.providerTaskId || upstreamId || result.taskId,
        segmentTaskId: kind === 'segment' ? result.taskId : active.segmentTaskId,
        modelUrl: kind === 'convert' ? active.modelUrl || result.modelUrl : result.modelUrl,
        pbrModelUrl: kind === 'convert' ? active.pbrModelUrl : result.pbrModelUrl || result.modelUrl,
        baseModelUrl: kind === 'convert' ? active.baseModelUrl : result.baseModelUrl,
        previewImageUrl: result.previewImageUrl || active.previewImageUrl,
        convertedUrls: converted,
        exportFormats: formats,
        meshOps: [...(active.meshOps || []), op].slice(-20),
        previewHint: `${result.label}完成 · 可环视 / 导出制造格式`,
        error: undefined,
        updatedAt: Date.now(),
      };
      patchJob(active.id, next);
      setBusy(false);
      setMsgTone('ok');
      if (kind === 'segment') {
        setPartsPreview(true);
        setWorkbenchTool('segment');
        setMsg('部件拆分完成：右侧已切换为「分件着色」预览，拖动「炸开」可看各部件');
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
            previewImageUrl: vaulted.previewImageUrl,
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

  /** 任意候选里只要有本机 vault/blob 就优先，避免还去拉已 403 的临时链 */
  const pickLocalOrRemoteModelUrl = (job: Model3dJob | null | undefined): string | undefined => {
    if (!job) return undefined;
    const candidates = [job.modelUrl, job.pbrModelUrl, job.baseModelUrl].filter(Boolean) as string[];
    const local = candidates.find(
      (u) => isVaultRef(u) || u.startsWith('blob:') || u.startsWith('data:')
    );
    return local || candidates[0];
  };
  const rawDownloadUrl = pickLocalOrRemoteModelUrl(active);
  const rawPreviewUrl = rawDownloadUrl;
  const downloadUrl = useVaultUrl(rawDownloadUrl);
  const previewUrl = useVaultUrl(rawPreviewUrl);
  const previewPoster = useVaultUrl(active?.previewImageUrl || active?.sourceImage);

  // 远程链过期(403)时：把本机 mesh_${jobId} 回挂到任务，避免黑屏空转
  useEffect(() => {
    if (!active || active.status !== 'ready') return;
    const primary = pickLocalOrRemoteModelUrl(active);
    if (primary && (isVaultRef(primary) || primary.startsWith('blob:') || primary.startsWith('data:'))) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const hit = await findModel3dVaultRefForJob(active);
      if (cancelled || !hit) return;
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

  return (
    <div className="max-w-[96rem] mx-auto space-y-3 animate-fade-in px-1">
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
      <div className="grid lg:grid-cols-12 gap-3">
        <div className="lg:col-span-3 space-y-3 max-h-[min(78vh,52rem)] overflow-y-auto custom-scrollbar pr-0.5">
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
                    <button
                      type="button"
                      onClick={() => {
                        setPartsPreview(true);
                        setMsgTone('ok');
                        setMsg('已切换到分件着色预览：颜色=部件，可调节「炸开」看间隙');
                      }}
                      className="w-full rounded-xl border border-teal-300 bg-white text-teal-900 text-[11px] font-black py-2"
                    >
                      查看拆分效果（着色 / 炸开）
                    </button>
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

        <div className="lg:col-span-6 rounded-2xl border border-slate-200 bg-slate-950 text-white overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-300">
            <span>
              {active?.status === 'ready' && downloadUrl
                ? partsPreview && hasSegmentResult
                  ? '拆分效果 · 分件着色'
                  : '3D 环视预览'
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
          <div className="relative w-full aspect-square max-h-[min(72vh,40rem)] mx-auto flex items-stretch justify-center">
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
              partsPreview && hasSegmentResult ? (
                <Model3dPartsViewer
                  key={`parts-${active.id}-${active.segmentTaskId || active.providerTaskId || ''}`}
                  src={(rawPreviewUrl || rawDownloadUrl || '').trim()}
                  className="w-full h-full min-h-0"
                  explode={0.4}
                  onPartsFound={(names) => {
                    setPartNames((prev) =>
                      prev.length === names.length && prev.every((n, i) => n === names[i])
                        ? prev
                        : names
                    );
                  }}
                />
              ) : (
              <Model3dOrbitViewer
                // 直接传 vault:/https，由预览组件本机秒开；勿等 useVaultUrl 异步，否则会空转半小时
                src={(rawPreviewUrl || rawDownloadUrl || '').trim()}
                stableKey={`${active.id}|${active.segmentTaskId || ''}|${active.providerTaskId || ''}|${active.updatedAt || 0}`}
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
                    setMsgTone('ok');
                    setMsg('已从本机素材库找回 GLB，可预览 / 下载');
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
              <div className="flex-1 flex items-center justify-center p-6">
                <VaultImg
                  src={active.previewImageUrl}
                  alt=""
                  className="max-h-72 rounded-2xl shadow-2xl shadow-indigo-500/20 object-contain"
                />
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
          {active?.status === 'ready' && downloadUrl && (
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
                        setPartsPreview(true);
                        setMsgTone('ok');
                        setMsg('分件着色预览：颜色区分部件，底部可调节炸开距离');
                      }}
                      className={`rounded-lg text-[10px] font-black px-2.5 py-1.5 ${
                        partsPreview
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-white/10 hover:bg-white/15'
                      }`}
                    >
                      分件着色
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPartsPreview(false);
                        setMsgTone('info');
                        setMsg('已切回整体环视预览');
                      }}
                      className={`rounded-lg text-[10px] font-black px-2.5 py-1.5 ${
                        !partsPreview
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-white/10 hover:bg-white/15'
                      }`}
                    >
                      整体环视
                    </button>
                    {partNames.length > 0 && (
                      <span className="text-[9px] font-bold text-teal-200/80 self-center">
                        {partNames.length} 个部件
                      </span>
                    )}
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

        <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col max-h-[32rem]">
          <div className="px-3 py-2.5 border-b border-slate-100 text-xs font-black text-slate-700">
            项目库 ({jobs.length})
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {jobs.map((j) => (
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
