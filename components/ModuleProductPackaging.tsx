import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PackageOpen,
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
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { User } from '../types';
import { ModuleType } from '../types';
import {
  PACKAGING_SKILLS,
  type PackagingAsset,
  type PackagingProject,
  type PackagingSkillId,
  loadPackagingAssets,
  loadPackagingProjects,
  newPackagingId,
  savePackagingAssets,
  savePackagingProjects,
} from '../services/packagingAgentStore';
import {
  generateDesignImages,
  getDesignAgentConfigStatus,
} from '../services/designAgentService';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import { compressImageDataUrl } from '../services/catalogExcelService';
import { consumeCreativeHandoff } from '../services/creativeAssetBridge';
import { persistPackagingAssets } from '../services/creativeAssetPersist';
import { CreativePipelineBar, CreativeRefPicker } from './CreativeRefPicker';
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
 * 包装设计：选包装形态 Skill → 描述 / 挂产品 → 确认后出包装视觉到画布。
 */
export const ModuleProductPackaging: React.FC<Props> = ({ currentUser, onNavigateModule }) => {
  const [projects, setProjects] = useState<PackagingProject[]>(() => loadPackagingProjects());
  const [assets, setAssets] = useState<PackagingAsset[]>(() => loadPackagingAssets());
  const [activeId, setActiveId] = useState<string | null>(projects[0]?.id || null);
  const [leftTab, setLeftTab] = useState<LeftTab>('skills');
  const [prompt, setPrompt] = useState('');
  const [skillId, setSkillId] = useState<PackagingSkillId>('window_box');
  const [size, setSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [count, setCount] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skuPick, setSkuPick] = useState('');
  const [refUploads, setRefUploads] = useState<string[]>([]);
  const [pickedRefs, setPickedRefs] = useState<string[]>([]);
  const [refBusy, setRefBusy] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const status = getDesignAgentConfigStatus();

  const active = projects.find((p) => p.id === activeId) || null;
  const canvasAssets = useMemo(
    () => assets.filter((a) => a.projectId === activeId),
    [assets, activeId]
  );

  useEffect(() => {
    const handoff = consumeCreativeHandoff('packaging');
    if (!handoff?.images?.length) return;
    setPickedRefs(handoff.images.slice(0, 3));
    if (handoff.skuCode) {
      const hit = skus.find((s) => s.skuCode === handoff.skuCode);
      if (hit) setSkuPick(hit.id);
    }
    if (!prompt.trim()) {
      setPrompt(
        handoff.note
          ? `根据产品主图设计包装：${handoff.note}`
          : '根据产品主图设计适合商超货架的开窗彩盒包装'
      );
    }
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅启动时消费一次交接包
  }, []);

  const persistProjects = (next: PackagingProject[]) => {
    setProjects(next);
    savePackagingProjects(next);
  };
  const persistAssets = (next: PackagingAsset[]) => {
    setAssets(next);
    savePackagingAssets(next);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = loadPackagingAssets();
        const migrated = await persistPackagingAssets(raw);
        if (cancelled) return;
        savePackagingAssets(migrated);
        setAssets(migrated);
      } catch (e) {
        console.warn('packaging assets migrate', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const skill = PACKAGING_SKILLS.find((s) => s.id === skillId) || PACKAGING_SKILLS[0];

  const createProject = (sid: PackagingSkillId = skillId) => {
    const sk = PACKAGING_SKILLS.find((s) => s.id === sid) || PACKAGING_SKILLS[0];
    const sku = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const now = Date.now();
    const proj: PackagingProject = {
      id: newPackagingId('pk'),
      title: sku ? `${sku.skuCode} · ${sk.label}` : `包装 · ${sk.label}`,
      skillId: sid,
      skuCode: sku?.skuCode,
      skuName: sku?.name,
      messages: [
        {
          id: newPackagingId('m'),
          role: 'agent',
          text: `你好，我是包装设计助手。请选择包装形态 Skill，描述产品与卖场，确认后生成包装视觉。当前「${sk.label}」：适合 ${sk.channel}；配色气质：${sk.palette}`,
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
  };

  const buildFinalPrompt = () => {
    const userBit = prompt.trim();
    const sku = active?.skuName
      ? `Product: ${active.skuName}${active.skuCode ? ` (${active.skuCode})` : ''}. `
      : skuPick
        ? (() => {
            const s = skus.find((x) => x.id === skuPick);
            return s ? `Product: ${s.name} (${s.skuCode}). ` : '';
          })()
        : '';
    const skillBit = skill.defaultPrompt ? `${skill.defaultPrompt}. ` : '';
    const craftBit = skill.craftNotes ? `Craft notes: ${skill.craftNotes}. ` : '';
    const channelBit = `Target retail channel: ${skill.channel}. Color direction: ${skill.palette}. `;
    const avoidBit = skill.negativePrompt ? ` Avoid: ${skill.negativePrompt}.` : '';
    return `${sku}${channelBit}${craftBit}${skillBit}${userBit || 'Create a polished commercial toy packaging design visual.'}${avoidBit}`.trim();
  };

  const requestGenerate = () => {
    if (!status.configured) {
      setError(status.detail);
      return;
    }
    if (!active) {
      createProject(skillId);
    }
    setConfirmOpen(true);
    setError(null);
  };

  const ensureProject = (): PackagingProject => {
    const existing = projects.find((p) => p.id === activeId);
    if (existing) return existing;
    const sk = PACKAGING_SKILLS.find((s) => s.id === skillId) || PACKAGING_SKILLS[0];
    const sku = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
    const now = Date.now();
    const proj: PackagingProject = {
      id: newPackagingId('pk'),
      title: sku ? `${sku.skuCode} · ${sk.label}` : `包装 · ${sk.label}`,
      skillId,
      skuCode: sku?.skuCode,
      skuName: sku?.name,
      messages: [
        {
          id: newPackagingId('m'),
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

  const collectRefImages = (proj: PackagingProject): string[] => {
    const boundSku =
      skus.find((s) => s.id === skuPick || s.skuCode === skuPick) ||
      skus.find((s) => s.skuCode === proj.skuCode);
    const fromSku = (boundSku?.images || []).filter(Boolean);
    const merged: string[] = [];
    for (const u of [...refUploads, ...pickedRefs, ...fromSku]) {
      if (!u || merged.includes(u)) continue;
      merged.push(u);
      if (merged.length >= 3) break;
    }
    return merged;
  };

  const runGenerate = async () => {
    setConfirmOpen(false);
    const proj = ensureProject();
    let finalPrompt = buildFinalPrompt();
    try {
      const skuRow = skus.find((s) => s.id === skuPick || s.skuCode === skuPick);
      const profiles = await loadProductCatalog();
      const journey = loadTradeJourney();
      const card = buildDesignConstraintCard({
        categoryOrName: skuRow?.category || skuRow?.name || active?.skuName || '玩具',
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
      const note = designConstraintToPromptNote(card);
      if (note) finalPrompt = `${finalPrompt}\n${note}`;
    } catch {
      /* ignore */
    }
    const refImages = collectRefImages(proj);
    const modeHint = refImages.length
      ? `参考图 ${refImages.length} 张 + 文字`
      : '纯文字';
    const userMsg = {
      id: newPackagingId('m'),
      role: 'user' as const,
      text: prompt.trim() || `使用 Skill「${skill.label}」生成包装（${modeHint}）`,
      at: Date.now(),
    };

    setLoading(true);
    setError(null);
    try {
      const result = await generateDesignImages({
        prompt: finalPrompt,
        size,
        n: count,
        thinkingMode: false,
        referenceImages: refImages.length ? refImages : undefined,
      });
      const now = Date.now();
      const newAssetsRaw: PackagingAsset[] = result.images.map((url) => ({
        id: newPackagingId('pa'),
        projectId: proj.id,
        url,
        prompt: finalPrompt,
        skillId,
        createdAt: now,
      }));
      const newAssets = await persistPackagingAssets(newAssetsRaw);
      const agentMsg = {
        id: newPackagingId('m'),
        role: 'agent' as const,
        text: `已生成 ${newAssets.length} 张「${skill.label}」包装视觉并放到画布（已存本机）。可换 Skill 再出一版，或改配色描述继续改稿。`,
        at: now,
        assetIds: newAssets.map((a) => a.id),
      };
      persistAssets([
        ...newAssets,
        ...loadPackagingAssets().filter((a) => !newAssets.some((n) => n.id === a.id)),
      ]);
      const latest = loadPackagingProjects();
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
      a.download = `packaging-${idx + 1}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, '_blank');
    }
  };

  const deleteAssetIds = (ids: string[]) => {
    if (!ids.length) return;
    if (!window.confirm(`确定删除 ${ids.length} 张包装图？`)) return;
    const ban = new Set(ids);
    persistAssets(assets.filter((a) => !ban.has(a.id)));
    persistProjects(
      projects.map((p) => ({
        ...p,
        assetIds: (p.assetIds || []).filter((id) => !ban.has(id)),
        updatedAt: Date.now(),
      }))
    );
  };

  return (
    <div className="max-w-[96rem] mx-auto animate-fade-in px-1 space-y-3">
      <div className="rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50/80 via-white to-orange-50/40 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 text-amber-200 text-[10px] font-black uppercase tracking-widest px-2.5 py-1">
            <PackageOpen size={11} /> Packaging Agent
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 mt-1.5">包装设计</h2>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1 max-w-2xl leading-relaxed">
            内置玩具包装形态 × 卖场适配 × 色彩气质。选 Skill → 挂产品或主图 → 确认生成包装视觉。
          </p>
          <div className="mt-2">
            <CreativePipelineBar current="packaging" onNavigate={onNavigateModule} />
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
            className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black px-3 py-2"
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
                  leftTab === id
                    ? 'text-amber-800 border-b-2 border-amber-600 bg-amber-50/50'
                    : 'text-slate-400'
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
                        ? 'border-amber-300 bg-amber-50 text-amber-950'
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
              PACKAGING_SKILLS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSkillId(s.id);
                    if (s.defaultPrompt) setPrompt(s.defaultPrompt);
                  }}
                  onDoubleClick={() => createProject(s.id)}
                  className={`w-full text-left rounded-xl px-3 py-2.5 border ${
                    skillId === s.id
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-slate-100 hover:border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-slate-800">{s.label}</span>
                    <span className="text-[9px] font-bold text-amber-700 uppercase">{s.category}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium mt-0.5 leading-snug">{s.hint}</p>
                  <p className="text-[9px] text-amber-800/80 font-semibold mt-1 leading-snug">
                    {s.channel}
                  </p>
                </button>
              ))}
            {leftTab === 'assets' &&
              (assets.length === 0 ? (
                <p className="text-xs text-slate-400 font-bold p-4 text-center">生成后会出现在这里</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 p-1">
                  {assets.slice(0, 40).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setActiveId(a.projectId)}
                      className="aspect-square rounded-lg overflow-hidden border border-slate-100"
                    >
                      <VaultImg src={a.url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              ))}
          </div>
        </aside>

        <section className="xl:col-span-6 rounded-2xl border border-slate-200 bg-slate-50/80 flex flex-col min-h-[22rem] overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200/80 bg-white/80 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-black text-slate-700 truncate">
              {active ? `画布 · ${active.title}` : '画布 · 新建或选择项目'}
            </div>
            <div className="flex items-center gap-2">
              <CreativeStorageBadge compact />
              <div className="text-[10px] font-bold text-slate-400">{canvasAssets.length} 张</div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
            {canvasAssets.length === 0 ? (
              <div className="h-full min-h-[16rem] flex flex-col items-center justify-center text-center px-6">
                <div className="h-14 w-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mb-3">
                  <PackageOpen size={24} />
                </div>
                <p className="text-sm font-black text-slate-700">空画布</p>
                <p className="text-xs text-slate-500 font-medium mt-1 max-w-sm leading-relaxed">
                  选左侧包装 Skill → 右侧挂产品或主图 → 确认生成。每种形态已内置卖场与配色方向。
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {canvasAssets.map((a, i) => (
                  <div
                    key={a.id}
                    className="rounded-xl overflow-hidden border border-white shadow-sm bg-white group relative"
                  >
                    <VaultImg src={a.url} alt="" className="w-full aspect-square object-contain bg-slate-50" />
                    <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {active && active.messages.length > 0 && (
            <div className="border-t border-slate-200 bg-white/90 max-h-28 overflow-y-auto px-3 py-2 space-y-1">
              {active.messages.slice(-4).map((m) => (
                <div
                  key={m.id}
                  className={`text-[11px] leading-snug ${
                    m.role === 'user' ? 'text-amber-900 font-bold' : 'text-slate-600 font-medium'
                  }`}
                >
                  {m.role === 'user' ? '你：' : 'Agent：'}
                  {m.text}
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="xl:col-span-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 flex flex-col gap-3">
          <div className="text-xs font-black text-slate-800">向包装 Agent 下指令</div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-2.5 py-2 space-y-1">
            <div className="text-[10px] font-black text-amber-900 uppercase">当前 Skill</div>
            <div className="text-sm font-black text-slate-900">{skill.label}</div>
            <div className="text-[10px] text-slate-600 font-medium leading-snug">
              卖场：{skill.channel}
            </div>
            <div className="text-[10px] text-amber-800 font-semibold leading-snug">
              配色：{skill.palette}
            </div>
            <div className="text-[9px] text-slate-400">{skill.aspectHint}</div>
          </div>
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
          </div>
          <CreativeRefPicker
            value={pickedRefs}
            onChange={setPickedRefs}
            multiple
            max={3}
            accent="violet"
            title="选用平面主图 / 产品库图（可点 × 移除推送图）"
            onSkuMeta={(meta) => {
              if (!meta?.skuCode) return;
              const hit = skus.find((s) => s.skuCode === meta.skuCode);
              if (hit) setSkuPick(hit.id);
            }}
          />
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
              <ImagePlus size={10} /> 上传参考图（可选）
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
                <div
                  key={`${i}-${src.slice(-24)}`}
                  className="relative w-14 h-14 rounded-lg overflow-hidden border border-amber-200 bg-slate-50"
                >
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
                  className="w-14 h-14 rounded-lg border border-dashed border-amber-300 text-amber-700 hover:bg-amber-50 flex flex-col items-center justify-center gap-0.5 disabled:opacity-50"
                >
                  {refBusy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                  <span className="text-[8px] font-black">上传</span>
                </button>
              )}
            </div>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="例如：特斯拉 Model Y 遥控车开窗彩盒，适合欧洲商超，儿童友好配色…"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium resize-y min-h-[5rem]"
          />
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
            disabled={loading}
            onClick={requestGenerate}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-sm font-black py-3"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {loading ? '包装生图中，约 1–2 分钟…' : '确认生成包装'}
          </button>
          <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
            建议先用平面主图作参考，再选对应卖场的包装 Skill，配色会按内置气质自动加强。
          </p>
        </aside>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3 border border-amber-100">
            <div className="font-extrabold text-slate-900 text-lg">确认生成包装</div>
            <p className="text-sm text-slate-600 font-medium leading-relaxed">
              Skill「{skill.label}」· {count} 张 · {size}
              <br />
              卖场：{skill.channel}
            </p>
            <p className="text-[11px] text-slate-500 bg-slate-50 rounded-xl px-3 py-2 font-medium max-h-24 overflow-y-auto">
              {buildFinalPrompt()}
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 border border-slate-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void runGenerate()}
                className="px-4 py-2 rounded-xl text-sm font-black text-white bg-amber-600"
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
