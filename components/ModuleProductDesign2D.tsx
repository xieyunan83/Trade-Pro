import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Plus,
  FolderOpen,
  LayoutGrid,
  Send,
  Loader2,
  Download,
  AlertTriangle,
  CheckCircle2,
  Package,
  ImagePlus,
  X,
  Trash2,
  Check,
} from 'lucide-react';
import type { User } from '../types';
import { ModuleType } from '../types';
import {
  DESIGN_SKILLS,
  type DesignAsset,
  type DesignProject,
  type DesignSkillId,
  loadDesignAssets,
  loadDesignProjects,
  newDesignId,
  saveDesignAssets,
  saveDesignProjects,
} from '../services/designAgentStore';
import {
  generateDesignImages,
  generateMultiAngleDesignImages,
  getDesignAgentConfigStatus,
} from '../services/designAgentService';
import { planCreativeBrief } from '../services/creativeAgent/runtime';
import type { CreativeBrief } from '../services/creativeAgent/types';
import { composeImageGenerationPrompt } from '../services/creativeQualityKit';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import { compressImageDataUrl } from '../services/catalogExcelService';
import { setCreativeHandoff } from '../services/creativeAssetBridge';
import { persistDesignAssets } from '../services/creativeAssetPersist';
import { CreativePipelineBar } from './CreativeRefPicker';
import { DesignConstraintCardPanel } from './DesignConstraintCardPanel';
import { CreativeStorageBadge } from './CreativeStorageBadge';
import { VaultImg } from './VaultMedia';
import { loadProductCatalog } from '../services/productCatalog';
import {
  buildDesignConstraintCard,
  designConstraintToPromptNote,
} from '../services/designConstraintCard';
import { loadTradeJourney } from '../services/tradeJourney';

type Props = {
  currentUser: User;
  onNavigateModule?: (mod: ModuleType) => void;
};

type LeftTab = 'projects' | 'skills' | 'assets';

/**
 * 产品设计 · 平面图：
 * Skills + 结构化 Brief（可插拔大脑）+ 确认后生图 + 画布资产
 */
export const ModuleProductDesign2D: React.FC<Props> = ({ currentUser, onNavigateModule }) => {
  const [projects, setProjects] = useState<DesignProject[]>(() => loadDesignProjects());
  const [assets, setAssets] = useState<DesignAsset[]>(() => loadDesignAssets());
  const [activeId, setActiveId] = useState<string | null>(projects[0]?.id || null);
  const [leftTab, setLeftTab] = useState<LeftTab>('skills');
  const [prompt, setPrompt] = useState('');
  /** 负向约束：选 Skill 时预填，可自行增删；生成时还会合并全站通用拒绝项 */
  const [negativePrompt, setNegativePrompt] = useState(
    () => DESIGN_SKILLS.find((s) => s.id === 'product_hero')?.negativePrompt || ''
  );
  const [skillId, setSkillId] = useState<DesignSkillId>('product_hero');
  const [size, setSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [count, setCount] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingBrief, setPendingBrief] = useState<CreativeBrief | null>(null);
  const [planning, setPlanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skuPick, setSkuPick] = useState('');
  /** 用户上传的参考图（data URL），可与文字描述组合图生图 */
  const [refUploads, setRefUploads] = useState<string[]>([]);
  const [refBusy, setRefBusy] = useState(false);
  /** 画布多选：用于删除 / 推送到下游模块 */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const refInputRef = useRef<HTMLInputElement>(null);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const status = getDesignAgentConfigStatus();

  const active = projects.find((p) => p.id === activeId) || null;
  const canvasAssets = useMemo(
    () => assets.filter((a) => a.projectId === activeId),
    [assets, activeId]
  );
  const selectedAssets = useMemo(
    () => canvasAssets.filter((a) => selectedIds.includes(a.id)),
    [canvasAssets, selectedIds]
  );

  React.useEffect(() => {
    setSelectedIds([]);
  }, [activeId]);

  const persistProjects = (next: DesignProject[]) => {
    setProjects(next);
    saveDesignProjects(next);
  };
  const persistAssets = (next: DesignAsset[]) => {
    setAssets(next);
    saveDesignAssets(next);
  };

  /** 启动时：把仍挂临时外链 / dataURL 的图迁入本机 IndexedDB */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = loadDesignAssets();
        const migrated = await persistDesignAssets(raw);
        if (cancelled) return;
        saveDesignAssets(migrated);
        setAssets(migrated);
      } catch (e) {
        console.warn('design assets migrate', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const skill = DESIGN_SKILLS.find((s) => s.id === skillId) || DESIGN_SKILLS[0];

  const createProject = (sid: DesignSkillId = skillId) => {
    const sk = DESIGN_SKILLS.find((s) => s.id === sid) || DESIGN_SKILLS[0];
    const sku = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const now = Date.now();
    const proj: DesignProject = {
      id: newDesignId('dp'),
      title: sku ? `${sku.skuCode} · ${sk.label}` : `新项目 · ${sk.label}`,
      skillId: sid,
      skuCode: sku?.skuCode,
      skuName: sku?.name,
      messages: [
        {
          id: newDesignId('m'),
          role: 'agent',
          text: `你好，我是产品设计助手。请选择 Skill、上传产品参考图并描述需求；系统会锁定产品身份、叠加负向约束与质检项，确认后生成。当前 Skill「${sk.label}」：${sk.hint}`,
          at: now,
        },
      ],
      assetIds: [],
      ownerUsername: currentUser.username,
      departmentId: currentUser.departmentId,
      createdAt: now,
      updatedAt: now,
    };
    persistProjects([proj, ...projects]);
    setActiveId(proj.id);
    setSkillId(sid);
    setLeftTab('projects');
    if (sk.defaultPrompt) setPrompt(sk.defaultPrompt);
    setNegativePrompt(sk.negativePrompt || '');
  };

  const resolveSkuMeta = () => {
    const fromActive = active?.skuCode
      ? { code: active.skuCode, name: active.skuName }
      : null;
    if (fromActive?.code) return fromActive;
    const s = skus.find((x) => x.id === skuPick || x.skuCode === skuPick);
    return s ? { code: s.skuCode, name: s.name } : { code: undefined, name: undefined };
  };

  const buildFinalPrompt = () => {
    if (pendingBrief?.toolPrompt) return pendingBrief.toolPrompt;
    const skuMeta = resolveSkuMeta();
    const skuRow = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const hasRefs = refUploads.length > 0 || !!(skuRow?.images?.length);
    return composeImageGenerationPrompt({
      skillDefaultPrompt:
        skill.defaultPrompt || 'Create a polished commercial product design visual',
      craftNotes: skill.craftNotes,
      userBrief: prompt.trim(),
      skuName: skuMeta.name,
      skuCode: skuMeta.code,
      hasReferenceImages: hasRefs,
      skillNegative: negativePrompt.trim() || skill.negativePrompt,
      series: skillId === 'listing_set',
    }).prompt;
  };

  const requestGenerate = async () => {
    if (!status.configured) {
      setError(status.detail);
      return;
    }
    if (!active) {
      createProject(skillId);
    }
    setError(null);
    setPlanning(true);
    try {
      const skuMeta = resolveSkuMeta();
      const skuRow = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
      const hasRefs =
        refUploads.length > 0 || !!(skuRow?.images?.length);
      let marketNote = '';
      try {
        const profiles = await loadProductCatalog();
        const journey = loadTradeJourney();
        const card = buildDesignConstraintCard({
          categoryOrName: skuRow?.category || skuMeta.name || prompt.trim() || '玩具',
          targetMarket: journey.targetMarket || undefined,
          profiles,
          ourFactoryCny:
            skuRow?.factoryPrice != null && skuRow.factoryPrice > 0
              ? skuRow.currency === 'USD'
                ? skuRow.factoryPrice * 7.2
                : skuRow.currency === 'EUR'
                  ? skuRow.factoryPrice * 7.8
                  : skuRow.factoryPrice
              : undefined,
        });
        marketNote = designConstraintToPromptNote(card);
      } catch {
        /* 约束卡失败不阻断设计 */
      }
      const brief = await planCreativeBrief({
        domain: 'design_2d',
        skillId,
        skillLabel: skill.label,
        skillHint: skill.hint,
        skillDefaultPrompt: skill.defaultPrompt,
        skillNegativePrompt: negativePrompt.trim() || skill.negativePrompt,
        skillCraftNotes: skill.craftNotes,
        skillQaChecklist: skill.qaChecklist,
        userBrief: [prompt.trim(), marketNote].filter(Boolean).join('\n'),
        skuCode: skuMeta.code,
        skuName: skuMeta.name,
        hasReferenceImages: hasRefs,
      });
      setPendingBrief(brief);
      setConfirmOpen(true);
    } catch (e: any) {
      setError(e?.message || '方案编排失败，请重试');
    } finally {
      setPlanning(false);
    }
  };

  const ensureProject = (): DesignProject => {
    const existing = projects.find((p) => p.id === activeId);
    if (existing) return existing;
    const sk = DESIGN_SKILLS.find((s) => s.id === skillId) || DESIGN_SKILLS[0];
    const sku = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const now = Date.now();
    const proj: DesignProject = {
      id: newDesignId('dp'),
      title: sku ? `${sku.skuCode} · ${sk.label}` : `新项目 · ${sk.label}`,
      skillId,
      skuCode: sku?.skuCode,
      skuName: sku?.name,
      messages: [
        {
          id: newDesignId('m'),
          role: 'agent',
          text: `项目已创建。Skill「${sk.label}」就绪。`,
          at: now,
        },
      ],
      assetIds: [],
      ownerUsername: currentUser.username,
      departmentId: currentUser.departmentId,
      createdAt: now,
      updatedAt: now,
    };
    const next = [proj, ...projects];
    persistProjects(next);
    setActiveId(proj.id);
    return proj;
  };

  const onPickRefFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setRefBusy(true);
    setError(null);
    try {
      const next = [...refUploads];
      for (const file of Array.from(files)) {
        if (next.length >= 3) break;
        if (!file.type.startsWith('image/')) continue;
        const raw = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('读取图片失败'));
          reader.readAsDataURL(file);
        });
        if (!raw.startsWith('data:image/')) continue;
        const compressed = await compressImageDataUrl(raw);
        next.push(compressed);
      }
      setRefUploads(next.slice(0, 3));
    } catch (e: any) {
      setError(e?.message || '参考图处理失败');
    } finally {
      setRefBusy(false);
      if (refInputRef.current) refInputRef.current.value = '';
    }
  };

  const collectRefImages = (proj: DesignProject): string[] => {
    const boundSku =
      skus.find((s) => s.id === skuPick || s.skuCode === skuPick) ||
      skus.find((s) => s.skuCode === proj.skuCode);
    const fromSku = (boundSku?.images || []).filter(Boolean);
    const merged: string[] = [];
    for (const u of [...refUploads, ...fromSku]) {
      if (!u || merged.includes(u)) continue;
      merged.push(u);
      if (merged.length >= 3) break;
    }
    return merged;
  };

  const runGenerate = async () => {
    setConfirmOpen(false);
    const proj = ensureProject();
    const finalPrompt = pendingBrief?.toolPrompt || buildFinalPrompt();
    const qaLine = pendingBrief?.qaChecklist?.length
      ? `\n质检关注：${pendingBrief.qaChecklist.slice(0, 3).join('；')}`
      : '';
    const refImages = collectRefImages(proj);
    const modeHint = refImages.length
      ? `参考图 ${refImages.length} 张 + 文字`
      : '纯文字';
    const userMsg = {
      id: newDesignId('m'),
      role: 'user' as const,
      text: prompt.trim() || `使用 Skill「${skill.label}」生成（${modeHint}）`,
      at: Date.now(),
    };

    setLoading(true);
    setError(null);
    try {
      const isMulti = skillId === 'multi_angle' || !!pendingBrief?.multiAngle;
      const result = isMulti
        ? await generateMultiAngleDesignImages({
            prompt: finalPrompt,
            size,
            thinkingMode: false,
            referenceImages: refImages.length ? refImages : undefined,
            negativePrompt: negativePrompt.trim() || skill.negativePrompt,
            onProgress: (done, total, label) => {
              setError(null);
              void done;
              void total;
              void label;
            },
          })
        : await generateDesignImages({
            prompt: finalPrompt,
            size,
            n: count,
            thinkingMode: false,
            referenceImages: refImages.length ? refImages : undefined,
            negativePrompt: negativePrompt.trim() || skill.negativePrompt,
            series: skillId === 'listing_set' || count > 1,
          });
      const now = Date.now();
      const newAssetsRaw: DesignAsset[] = result.images.map((url, i) => ({
        id: newDesignId('da'),
        projectId: proj.id,
        url,
        prompt: finalPrompt,
        skillId,
        angle: result.angles?.[i],
        createdAt: now,
      }));
      // 立刻落本机素材库，避免供应商临时链过期后画布裂图
      const newAssets = await persistDesignAssets(newAssetsRaw);
      const agentMsg = {
        id: newDesignId('m'),
        role: 'agent' as const,
        text: isMulti
          ? `已生成 ${newAssets.length} 张多角度套图（${(result.angles || []).join(' / ')}）。可点画布上「送去 3D / 视频」继续流水线。${qaLine}`
          : `已按确认方案生成 ${newAssets.length} 张并放到画布（${modeHint}）。可继续改稿，或送去 3D / 视频。${qaLine}`,
        at: now,
        assetIds: newAssets.map((a) => a.id),
      };
      persistAssets([...newAssets, ...loadDesignAssets().filter((a) => !newAssets.some((n) => n.id === a.id))]);
      const latest = loadDesignProjects();
      persistProjects(
        latest.map((p) =>
          p.id === proj.id
            ? {
                ...p,
                skillId,
                messages: [...p.messages, userMsg, agentMsg],
                assetIds: [...newAssets.map((a) => a.id), ...p.assetIds],
                updatedAt: now,
              }
            : p
        )
      );
      setPrompt('');
    } catch (e: any) {
      setError(e?.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const downloadUrl = async (url: string, idx: number) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `design-2d-${idx + 1}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, '_blank');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAllCanvas = () => {
    setSelectedIds(canvasAssets.map((a) => a.id));
  };

  const clearSelection = () => setSelectedIds([]);

  const deleteAssetIds = (ids: string[]) => {
    if (!ids.length) return;
    if (!window.confirm(`确定删除 ${ids.length} 张图片？删除后不可恢复。`)) return;
    const ban = new Set(ids);
    persistAssets(assets.filter((a) => !ban.has(a.id)));
    persistProjects(
      projects.map((p) => ({
        ...p,
        assetIds: (p.assetIds || []).filter((id) => !ban.has(id)),
        updatedAt: Date.now(),
      }))
    );
    setSelectedIds((prev) => prev.filter((id) => !ban.has(id)));
    setError(null);
  };

  const sendAssetsTo = (
    target: 'design_3d' | 'ai_video' | 'packaging' | 'product_match',
    urls: string[],
    note?: string
  ) => {
    if (!urls.length && target !== 'product_match') {
      setError('请先勾选要推送的图片（可多选）');
      return;
    }
    const sku =
      skus.find((s) => s.id === skuPick || s.skuCode === skuPick) ||
      (active?.skuCode
        ? { skuCode: active.skuCode, name: active.skuName || active.skuCode }
        : null);
    const maxImgs = target === 'design_3d' ? 4 : target === 'packaging' ? 3 : 6;
    const sliced = urls.slice(0, maxImgs);
    setCreativeHandoff({
      images: sliced,
      skuCode: sku?.skuCode || active?.skuCode,
      skuName: (sku as any)?.name || active?.skuName || active?.title,
      note: note || active?.title,
      from: 'design_2d',
      target,
    });
    onNavigateModule?.(
      target === 'design_3d'
        ? ModuleType.PRODUCT_DESIGN_3D
        : target === 'packaging'
          ? ModuleType.PRODUCT_PACKAGING
          : target === 'product_match'
            ? ModuleType.PRODUCT_MATCH
            : ModuleType.PRODUCT_AI_VIDEO
    );
  };

  const sendSelectedTo = (target: 'design_3d' | 'ai_video' | 'packaging' | 'product_match') => {
    const urls = selectedAssets.map((a) => a.url);
    if (!urls.length && target !== 'product_match') {
      setError('请先勾选图片，再推送到下游模块');
      return;
    }
    const label =
      target === 'design_3d'
        ? '3D'
        : target === 'packaging'
          ? '包装'
          : target === 'product_match'
            ? '产品匹配'
            : '视频';
    const fallbackUrls =
      urls.length > 0
        ? urls
        : canvasAssets
            .slice(0, 2)
            .map((a) => a.url)
            .filter(Boolean);
    sendAssetsTo(target, fallbackUrls, `${active?.title || '平面项目'} → ${label}`);
  };

  return (
    <div className="max-w-[96rem] mx-auto animate-fade-in px-1 space-y-3">
      {/* 顶栏 */}
      <div className="rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/80 via-white to-cyan-50/50 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 text-violet-200 text-[10px] font-black uppercase tracking-widest px-2.5 py-1">
            <Sparkles size={11} /> Design Agent · 平面
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 mt-1.5">产品设计 · 平面图</h2>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1 max-w-2xl leading-relaxed">
            文字 / 参考图生图；「多角度套图」一次出正面·45°·侧面·背面，可直接送去 3D 与视频。
          </p>
          <div className="mt-2">
            <CreativePipelineBar current="2d" onNavigate={onNavigateModule} />
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`text-xs font-black ${status.configured ? 'text-emerald-700' : 'text-amber-700'}`}
          >
            {status.configured ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={14} /> {status.label}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <AlertTriangle size={14} /> {status.label}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-400 font-semibold mt-0.5 max-w-[14rem]">{status.detail}</div>
          <button
            type="button"
            onClick={() => createProject(skillId)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black px-3 py-2"
          >
            <Plus size={14} /> 新建项目
          </button>
        </div>
      </div>

      <DesignConstraintCardPanel
        compact
        categoryOrName={
          skus.find((s) => s.id === skuPick || s.skuCode === skuPick)?.category ||
          skus.find((s) => s.id === skuPick || s.skuCode === skuPick)?.name ||
          active?.skuName ||
          '玩具'
        }
        skuCode={
          skus.find((s) => s.id === skuPick || s.skuCode === skuPick)?.skuCode ||
          active?.skuCode
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 min-h-[32rem]">
        {/* 左：Projects / Skills / Assets */}
        <aside className="xl:col-span-3 rounded-2xl border border-slate-200 bg-white flex flex-col min-h-[20rem] overflow-hidden">
          <div className="flex border-b border-slate-100">
            {(
              [
                ['projects', '项目', FolderOpen],
                ['skills', 'Skills', Sparkles],
                ['assets', '资产', LayoutGrid],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLeftTab(id)}
                className={`flex-1 py-2.5 text-[11px] font-black flex items-center justify-center gap-1 ${
                  leftTab === id ? 'text-violet-700 border-b-2 border-violet-600 bg-violet-50/50' : 'text-slate-400'
                }`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
            {leftTab === 'projects' &&
              (projects.length === 0 ? (
                <p className="text-xs text-slate-400 font-bold p-4 text-center">暂无项目，点 Skills 或新建</p>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setActiveId(p.id);
                      setSkillId(p.skillId);
                    }}
                    className={`w-full text-left rounded-xl px-3 py-2.5 text-xs font-bold border ${
                      activeId === p.id
                        ? 'border-violet-300 bg-violet-50 text-violet-900'
                        : 'border-transparent hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="truncate">{p.title}</div>
                    <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                      {p.assetIds.length} 资产 · {new Date(p.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                ))
              ))}
            {leftTab === 'skills' &&
              DESIGN_SKILLS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSkillId(s.id);
                    if (s.defaultPrompt) setPrompt(s.defaultPrompt);
                    setNegativePrompt(s.negativePrompt || '');
                  }}
                  onDoubleClick={() => createProject(s.id)}
                  className={`w-full text-left rounded-xl px-3 py-2.5 border ${
                    skillId === s.id
                      ? 'border-violet-300 bg-violet-50'
                      : 'border-slate-100 hover:border-violet-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-slate-800">{s.label}</span>
                    <span className="text-[9px] font-bold text-violet-600 uppercase">{s.category}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium mt-0.5 leading-snug">{s.hint}</p>
                </button>
              ))}
            {leftTab === 'assets' &&
              (assets.length === 0 ? (
                <p className="text-xs text-slate-400 font-bold p-4 text-center">生成后会出现在这里</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 p-1">
                  {assets.slice(0, 40).map((a) => (
                    <div
                      key={a.id}
                      className="relative aspect-square rounded-lg overflow-hidden border border-slate-100 group"
                    >
                      <button
                        type="button"
                        onClick={() => setActiveId(a.projectId)}
                        className="w-full h-full"
                      >
                        <VaultImg src={a.url} alt="" className="w-full h-full object-cover" />
                      </button>
                      <button
                        type="button"
                        title="删除"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAssetIds([a.id]);
                        }}
                        className="absolute top-1 right-1 rounded-md bg-rose-600 text-white p-1 opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </aside>

        {/* 中：Canvas */}
        <section className="xl:col-span-6 rounded-2xl border border-slate-200 bg-slate-50/80 flex flex-col min-h-[22rem] overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200/80 bg-white/80 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-black text-slate-700 truncate">
              {active ? `画布 · ${active.title}` : '画布 · 新建或选择项目'}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <CreativeStorageBadge compact />
              <div className="text-[10px] font-bold text-slate-400">
                {canvasAssets.length} 张
                {selectedIds.length ? ` · 已选 ${selectedIds.length}` : ''}
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
            {canvasAssets.length === 0 ? (
              <div className="h-full min-h-[16rem] flex flex-col items-center justify-center text-center px-6">
                <div className="h-14 w-14 rounded-2xl bg-violet-100 text-violet-600 flex items-center justify-center mb-3">
                  <Sparkles size={24} />
                </div>
                <p className="text-sm font-black text-slate-700">空画布</p>
                <p className="text-xs text-slate-500 font-medium mt-1 max-w-sm leading-relaxed">
                  选左侧 Skill → 下方描述需求 → 确认生成。也可挂接「产品库」SKU，让 Agent 围绕真实货号出图。
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5 items-center">
                  <button
                    type="button"
                    onClick={selectAllCanvas}
                    className="text-[10px] font-black rounded-lg border border-slate-200 bg-white text-slate-600 px-2.5 py-1.5"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    disabled={!selectedIds.length}
                    className="text-[10px] font-black rounded-lg border border-slate-200 bg-white text-slate-600 px-2.5 py-1.5 disabled:opacity-40"
                  >
                    取消选择
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteAssetIds(selectedIds)}
                    disabled={!selectedIds.length}
                    className="text-[10px] font-black rounded-lg bg-rose-600 text-white px-2.5 py-1.5 inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    <Trash2 size={11} /> 删除选中
                  </button>
                  {onNavigateModule ? (
                    <>
                      <span className="text-[10px] text-slate-300 px-0.5">|</span>
                      <button
                        type="button"
                        onClick={() => sendSelectedTo('design_3d')}
                        disabled={!selectedIds.length}
                        className="text-[10px] font-black rounded-lg bg-indigo-600 text-white px-2.5 py-1.5 disabled:opacity-40"
                      >
                        选中 → 3D
                      </button>
                      <button
                        type="button"
                        onClick={() => sendSelectedTo('ai_video')}
                        disabled={!selectedIds.length}
                        className="text-[10px] font-black rounded-lg bg-rose-600 text-white px-2.5 py-1.5 disabled:opacity-40"
                      >
                        选中 → 视频
                      </button>
                      <button
                        type="button"
                        onClick={() => sendSelectedTo('packaging')}
                        disabled={!selectedIds.length}
                        className="text-[10px] font-black rounded-lg bg-amber-600 text-white px-2.5 py-1.5 disabled:opacity-40"
                      >
                        选中 → 包装
                      </button>
                      <button
                        type="button"
                        onClick={() => sendSelectedTo('product_match')}
                        className="text-[10px] font-black rounded-lg bg-emerald-600 text-white px-2.5 py-1.5"
                      >
                        → 产品匹配
                      </button>
                    </>
                  ) : null}
                </div>
                <p className="text-[10px] text-slate-400 font-medium">
                  点击图片勾选；可多选后推送。3D 最多 4 张（多视图），视频最多 6 张，包装最多 3 张。
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {canvasAssets.map((a, i) => {
                    const selected = selectedIds.includes(a.id);
                    return (
                      <div
                        key={a.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleSelect(a.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleSelect(a.id);
                          }
                        }}
                        className={`rounded-xl overflow-hidden border shadow-sm bg-white group relative cursor-pointer ${
                          selected
                            ? 'border-violet-500 ring-2 ring-violet-200'
                            : 'border-white hover:border-violet-200'
                        }`}
                      >
                        <VaultImg
                          src={a.url}
                          alt=""
                          className="w-full aspect-square object-contain bg-slate-50 pointer-events-none"
                        />
                        <span
                          className={`absolute top-2 right-2 h-6 w-6 rounded-full border-2 flex items-center justify-center ${
                            selected
                              ? 'bg-violet-600 border-violet-600 text-white'
                              : 'bg-white/90 border-slate-300 text-transparent'
                          }`}
                        >
                          <Check size={12} strokeWidth={3} />
                        </span>
                        {a.angle ? (
                          <span className="absolute top-2 left-2 rounded-md bg-slate-900/80 text-white text-[10px] font-black px-2 py-0.5">
                            {a.angle}
                          </span>
                        ) : null}
                        <div
                          className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => void downloadUrl(a.url, i)}
                            className="rounded-lg bg-slate-900/80 text-white p-1.5"
                            title="下载"
                          >
                            <Download size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteAssetIds([a.id])}
                            className="rounded-lg bg-rose-600/95 text-white p-1.5"
                            title="删除"
                          >
                            <Trash2 size={12} />
                          </button>
                          {onNavigateModule ? (
                            <>
                              <button
                                type="button"
                                onClick={() => sendAssetsTo('design_3d', [a.url], a.angle)}
                                className="rounded-lg bg-indigo-600/95 text-white text-[9px] font-black px-2 py-1.5"
                              >
                                → 3D
                              </button>
                              <button
                                type="button"
                                onClick={() => sendAssetsTo('ai_video', [a.url], a.angle)}
                                className="rounded-lg bg-rose-600/95 text-white text-[9px] font-black px-2 py-1.5"
                              >
                                → 视频
                              </button>
                              <button
                                type="button"
                                onClick={() => sendAssetsTo('packaging', [a.url], a.angle)}
                                className="rounded-lg bg-amber-600/95 text-white text-[9px] font-black px-2 py-1.5"
                              >
                                → 包装
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {/* 对话摘要 */}
          {active && active.messages.length > 0 && (
            <div className="border-t border-slate-200 bg-white/90 max-h-28 overflow-y-auto px-3 py-2 space-y-1">
              {active.messages.slice(-4).map((m) => (
                <div
                  key={m.id}
                  className={`text-[11px] leading-snug ${
                    m.role === 'user' ? 'text-violet-800 font-bold' : 'text-slate-600 font-medium'
                  }`}
                >
                  {m.role === 'user' ? '你：' : 'Agent：'}
                  {m.text}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 右：Agent 输入 */}
        <aside className="xl:col-span-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 flex flex-col gap-3">
          <div className="text-xs font-black text-slate-800">向 Agent 下指令</div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
              <Package size={10} /> 产品库 SKU（可选）
            </label>
            <select
              className="w-full mt-1 rounded-xl border border-slate-200 px-2.5 py-2 text-xs"
              value={skuPick}
              onChange={(e) => setSkuPick(e.target.value)}
            >
              <option value="">不绑定</option>
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.skuCode} · {s.name}
                  {s.images?.length ? ' · 有图' : ''}
                </option>
              ))}
            </select>
            {(() => {
              const s = skus.find((x) => x.id === skuPick);
              const img0 = s?.images?.[0];
              if (!img0 || /toysbear\.net/i.test(img0)) return null;
              return (
                <div className="mt-2 flex items-center gap-2">
                  <img
                    src={img0}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover border border-violet-100"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <span className="text-[10px] font-bold text-violet-700">
                    生成时将用此产品图作参考二次创作
                  </span>
                </div>
              );
            })()}
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase">当前 Skill</label>
            <div className="mt-1 text-sm font-black text-violet-800">{skill.label}</div>
            <div className="text-[10px] text-slate-500">{skill.aspectHint}</div>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
              <ImagePlus size={10} /> 参考图（可选，最多 3 张）
            </label>
            <input
              ref={refInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/bmp"
              multiple
              className="hidden"
              onChange={(e) => void onPickRefFiles(e.target.files)}
            />
            <div className="mt-1.5 flex flex-wrap gap-2">
              {refUploads.map((src, i) => (
                <div key={`${i}-${src.slice(-24)}`} className="relative w-14 h-14 rounded-lg overflow-hidden border border-violet-200 bg-slate-50">
                  <img src={src} alt="" className="w-full h-full object-contain" />
                  <button
                    type="button"
                    aria-label="移除参考图"
                    onClick={() => setRefUploads((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 rounded-full bg-slate-900/80 text-white p-0.5"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              {refUploads.length < 3 && (
                <button
                  type="button"
                  disabled={refBusy || loading}
                  onClick={() => refInputRef.current?.click()}
                  className="w-14 h-14 rounded-lg border border-dashed border-violet-300 text-violet-600 hover:bg-violet-50 flex flex-col items-center justify-center gap-0.5 disabled:opacity-50"
                >
                  {refBusy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                  <span className="text-[8px] font-black">上传</span>
                </button>
              )}
            </div>
            <p className="text-[9px] text-slate-400 font-medium mt-1 leading-relaxed">
              有参考图时按「图 + 文」改稿；无参考图则纯文字生图。上传图会自动压缩以节省额度。
            </p>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="例如：遥控车主图，白底，包装盒完整可见，适合亚马逊主图…"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium resize-y min-h-[5rem]"
          />
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                负向约束（不想出现的）
              </label>
              <button
                type="button"
                onClick={() => setNegativePrompt(skill.negativePrompt || '')}
                className="text-[9px] font-bold text-violet-600 hover:text-violet-800"
              >
                恢复 Skill 默认
              </button>
            </div>
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={2}
              placeholder="如：水印、乱码字、换色、多面板拼图…"
              className="w-full rounded-xl border border-rose-100 bg-rose-50/40 px-3 py-2 text-xs font-medium text-slate-700 resize-y"
            />
            <p className="text-[9px] text-slate-400 font-medium mt-1 leading-relaxed">
              选 Skill 会预填；可自行增删。系统仍会自动叠加通用拒绝项（水印/乱码/假认证等）。
            </p>
          </div>
          <div className="flex gap-2">
            <select
              className="flex-1 rounded-xl border border-slate-200 px-2 py-2 text-xs font-bold"
              value={size}
              onChange={(e) => setSize(e.target.value as '1K' | '2K' | '4K')}
            >
              <option value="1K">1K（省额度）</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
            <select
              className="w-20 rounded-xl border border-slate-200 px-2 py-2 text-xs font-bold"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 张
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={loading || planning || !status.configured}
            onClick={() => void requestGenerate()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-black py-3"
          >
            {loading || planning ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {planning
              ? '正在编排方案…'
              : loading
                ? skillId === 'multi_angle'
                  ? '多角度生成中（约需数分钟）…'
                  : '生图中，约 1–2 分钟…'
                : skillId === 'multi_angle'
                  ? '确认生成多角度套图'
                  : '确认生成'}
          </button>
          <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
            {skillId === 'multi_angle'
              ? '多角度将连续生成 4 张（默认 1K），便于后续 3D / 视频。'
              : '默认 1K、1 张更省额度；需要更清晰再选 2K。生成前需确认。'}
          </p>
        </aside>
      </div>

      {/* 确认卡 */}
      {confirmOpen && pendingBrief && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3 border border-violet-100">
            <div className="font-extrabold text-slate-900 text-lg">
              {pendingBrief.titleZh || '确认生成'}
            </div>
            <p className="text-sm text-slate-600 font-medium leading-relaxed">
              {pendingBrief.summaryZh}
              <br />
              <span className="text-slate-400 text-xs">
                Skill「{skill.label}」·{' '}
                {skillId === 'multi_angle' || pendingBrief.multiAngle
                  ? '4 视角套图'
                  : `${count} 张`}{' '}
                · {size}
              </span>
            </p>
            {refUploads.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {refUploads.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt=""
                    className="w-12 h-12 rounded-lg object-contain border border-slate-200 bg-slate-50"
                  />
                ))}
              </div>
            )}
            {pendingBrief.qaChecklist?.length > 0 && (
              <ul className="text-[11px] text-slate-600 bg-violet-50/80 rounded-xl px-3 py-2 space-y-1 font-medium">
                {pendingBrief.qaChecklist.slice(0, 4).map((q) => (
                  <li key={q} className="flex gap-1.5">
                    <CheckCircle2 size={12} className="text-violet-500 shrink-0 mt-0.5" />
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-500 bg-slate-50 rounded-xl px-3 py-2 font-medium max-h-24 overflow-y-auto">
              {pendingBrief.toolPrompt || buildFinalPrompt()}
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setPendingBrief(null);
                }}
                className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 border border-slate-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void runGenerate()}
                className="px-4 py-2 rounded-xl text-sm font-black text-white bg-violet-600"
              >
                开始生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
