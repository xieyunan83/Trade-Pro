import React, { useMemo, useState } from 'react';
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
} from 'lucide-react';
import type { User } from '../types';
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
import { generateDesignImages, getDesignAgentConfigStatus } from '../services/designAgentService';
import { loadCatalogSkus } from '../services/productCatalogTypes';

type Props = {
  currentUser: User;
};

type LeftTab = 'projects' | 'skills' | 'assets';

/**
 * 产品设计 · 平面图 —— 对齐 Lovart 理念：
 * Design Agent + Skills 一键工作流 + Canvas 资产沉淀 + 确认后生成
 * @see https://www.lovart.ai/
 */
export const ModuleProductDesign2D: React.FC<Props> = ({ currentUser }) => {
  const [projects, setProjects] = useState<DesignProject[]>(() => loadDesignProjects());
  const [assets, setAssets] = useState<DesignAsset[]>(() => loadDesignAssets());
  const [activeId, setActiveId] = useState<string | null>(projects[0]?.id || null);
  const [leftTab, setLeftTab] = useState<LeftTab>('skills');
  const [prompt, setPrompt] = useState('');
  const [skillId, setSkillId] = useState<DesignSkillId>('product_hero');
  const [size, setSize] = useState<'1K' | '2K' | '4K'>('2K');
  const [count, setCount] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skuPick, setSkuPick] = useState('');
  const skus = useMemo(() => loadCatalogSkus(), []);
  const status = getDesignAgentConfigStatus();

  const active = projects.find((p) => p.id === activeId) || null;
  const canvasAssets = useMemo(
    () => assets.filter((a) => a.projectId === activeId),
    [assets, activeId]
  );

  const persistProjects = (next: DesignProject[]) => {
    setProjects(next);
    saveDesignProjects(next);
  };
  const persistAssets = (next: DesignAsset[]) => {
    setAssets(next);
    saveDesignAssets(next);
  };

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
          text: `你好，我是产品设计助手。请选择 Skill、描述需求，确认后生成平面图。当前 Skill「${sk.label}」：${sk.hint}`,
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
    return `${sku}${skillBit}${userBit || 'Create a polished commercial product design visual.'}`.trim();
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

  const runGenerate = async () => {
    setConfirmOpen(false);
    const proj = ensureProject();
    const finalPrompt = buildFinalPrompt();
    const boundSku =
      skus.find((s) => s.id === skuPick || s.skuCode === skuPick) ||
      skus.find((s) => s.skuCode === proj.skuCode);
    const refImages = (boundSku?.images || []).filter(Boolean).slice(0, 2);
    const userMsg = {
      id: newDesignId('m'),
      role: 'user' as const,
      text: prompt.trim() || `使用 Skill「${skill.label}」生成`,
      at: Date.now(),
    };

    setLoading(true);
    setError(null);
    try {
      const result = await generateDesignImages({
        prompt: finalPrompt,
        size,
        n: count,
        thinkingMode: true,
        referenceImages: refImages.length ? refImages : undefined,
      });
      const now = Date.now();
      const newAssets: DesignAsset[] = result.images.map((url) => ({
        id: newDesignId('da'),
        projectId: proj.id,
        url,
        prompt: finalPrompt,
        skillId,
        createdAt: now,
      }));
      const agentMsg = {
        id: newDesignId('m'),
        role: 'agent' as const,
        text: `已生成 ${newAssets.length} 张并放到画布。可继续改稿，例如「背景更干净」「保留包装文字」。`,
        at: now,
        assetIds: newAssets.map((a) => a.id),
      };
      persistAssets([...newAssets, ...loadDesignAssets()]);
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
            选择 Skill、描述需求并确认后生成平面图，结果保存在本项目画布中，可下载复用。
          </p>
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
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setActiveId(a.projectId)}
                      className="aspect-square rounded-lg overflow-hidden border border-slate-100"
                    >
                      <img src={a.url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              ))}
          </div>
        </aside>

        {/* 中：Canvas */}
        <section className="xl:col-span-6 rounded-2xl border border-slate-200 bg-slate-50/80 flex flex-col min-h-[22rem] overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200/80 bg-white/80 flex items-center justify-between gap-2">
            <div className="text-xs font-black text-slate-700 truncate">
              {active ? `画布 · ${active.title}` : '画布 · 新建或选择项目'}
            </div>
            <div className="text-[10px] font-bold text-slate-400">{canvasAssets.length} 张</div>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {canvasAssets.map((a, i) => (
                  <div
                    key={a.id}
                    className="rounded-xl overflow-hidden border border-white shadow-sm bg-white group relative"
                  >
                    <img src={a.url} alt="" className="w-full aspect-square object-cover" />
                    <button
                      type="button"
                      onClick={() => void downloadUrl(a.url, i)}
                      className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg bg-slate-900/80 text-white p-2"
                    >
                      <Download size={14} />
                    </button>
                  </div>
                ))}
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
              if (!s?.images?.[0]) return null;
              return (
                <div className="mt-2 flex items-center gap-2">
                  <img
                    src={s.images[0]}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover border border-violet-100"
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
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="例如：遥控车主图，白底，包装盒完整可见，适合亚马逊主图…"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium resize-y min-h-[6rem]"
          />
          <div className="flex gap-2">
            <select
              className="flex-1 rounded-xl border border-slate-200 px-2 py-2 text-xs font-bold"
              value={size}
              onChange={(e) => setSize(e.target.value as '1K' | '2K' | '4K')}
            >
              <option value="1K">1K</option>
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
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-black py-3"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {loading ? '生图中，约 1–2 分钟…' : '确认生成'}
          </button>
          <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
            生成前需确认，避免误消耗额度。复杂场景可能需要一两分钟，请勿关闭页面。
          </p>
        </aside>
      </div>

      {/* 确认卡 */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3 border border-violet-100">
            <div className="font-extrabold text-slate-900 text-lg">确认生成</div>
            <p className="text-sm text-slate-600 font-medium leading-relaxed">
              Skill「{skill.label}」· {count} 张 · {size}
              <br />
              引擎：{status.label}
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
