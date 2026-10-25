import React, { useMemo, useState } from 'react';
import {
  Code2,
  Send,
  Loader2,
  Globe,
  Plus,
  Trash2,
  Eye,
  Package,
  CheckCircle2,
} from 'lucide-react';
import type { User } from '../types';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import {
  type SiteProject,
  loadSiteProjects,
  saveSiteProjects,
  newCreativeId,
  draftSiteSectionsFromBrief,
} from '../services/creativeStudioStore';

type Props = { currentUser: User };

const LOCALE_LABEL: Record<SiteProject['locale'], string> = {
  zh: '中文',
  en: 'English',
  es: 'Español',
  ar: 'العربية',
};

/**
 * 独立站 / 货源站：对话描述 → 实时预览区块 → 挂接产品库 → 发布草稿。
 * 工作流对齐「描述即构建」类建站工具（界面不含第三方平台名）。
 */
export const ModuleSiteBuilder: React.FC<Props> = ({ currentUser }) => {
  const [projects, setProjects] = useState<SiteProject[]>(() => loadSiteProjects());
  const [activeId, setActiveId] = useState<string | null>(projects[0]?.id || null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [skuCodes, setSkuCodes] = useState<string[]>([]);
  const skus = useMemo(() => loadCatalogSkus(), []);
  const active = projects.find((p) => p.id === activeId) || null;

  const persist = (next: SiteProject[]) => {
    setProjects(next);
    saveSiteProjects(next);
  };

  const createBlank = () => {
    const now = Date.now();
    const proj: SiteProject = {
      id: newCreativeId('site'),
      title: '新货源站',
      brief: '',
      locale: 'en',
      skuCodes: [],
      sections: draftSiteSectionsFromBrief('Your Product Showcase', []),
      messages: [
        {
          id: newCreativeId('m'),
          role: 'agent',
          text: '描述你想要的独立站 / 货源落地页：行业、语气、主推产品、目标市场。我会生成可预览的页面结构，你可继续改。',
          at: now,
        },
      ],
      published: false,
      ownerUsername: currentUser.username,
      createdAt: now,
      updatedAt: now,
    };
    persist([proj, ...projects]);
    setActiveId(proj.id);
    setSkuCodes([]);
  };

  const send = async () => {
    if (!active || !input.trim()) return;
    const text = input.trim();
    setInput('');
    setBusy(true);
    const userMsg = { id: newCreativeId('m'), role: 'user' as const, text, at: Date.now() };
    const skuLabels = skus
      .filter((s) => (skuCodes.length ? skuCodes : active.skuCodes).includes(s.skuCode))
      .map((s) => `${s.skuCode} ${s.name}`);
    const sections = draftSiteSectionsFromBrief(text, skuLabels);
    await new Promise((r) => setTimeout(r, 500));
    const agentMsg = {
      id: newCreativeId('m'),
      role: 'agent' as const,
      text: `已根据「${text.slice(0, 40)}${text.length > 40 ? '…' : ''}」更新页面预览。右侧可继续微调标题与正文；满意后点「标记可发布」。`,
      at: Date.now(),
    };
    const next: SiteProject = {
      ...active,
      title: text.slice(0, 36) || active.title,
      brief: text,
      skuCodes: skuCodes.length ? skuCodes : active.skuCodes,
      sections,
      messages: [...active.messages, userMsg, agentMsg],
      updatedAt: Date.now(),
    };
    persist(projects.map((p) => (p.id === active.id ? next : p)));
    setBusy(false);
  };

  const patchSection = (secId: string, patch: Partial<{ title: string; body: string }>) => {
    if (!active) return;
    const next: SiteProject = {
      ...active,
      sections: active.sections.map((s) => (s.id === secId ? { ...s, ...patch } : s)),
      updatedAt: Date.now(),
    };
    persist(projects.map((p) => (p.id === active.id ? next : p)));
  };

  const togglePublish = () => {
    if (!active) return;
    const next = { ...active, published: !active.published, updatedAt: Date.now() };
    persist(projects.map((p) => (p.id === active.id ? next : p)));
  };

  const remove = (id: string) => {
    if (!confirm('删除该站点项目？')) return;
    const next = projects.filter((p) => p.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id || null);
  };

  const exportHtml = () => {
    if (!active) return;
    const html = `<!DOCTYPE html><html lang="${active.locale}"><head><meta charset="utf-8"/><title>${active.title}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
section{padding:3rem 1.5rem;max-width:720px;margin:0 auto;border-bottom:1px solid #1e293b}
h1,h2{letter-spacing:-0.02em} .cta{display:inline-block;margin-top:1rem;padding:.75rem 1.25rem;background:#22d3ee;color:#0f172a;border-radius:999px;font-weight:800;text-decoration:none}</style>
</head><body>
${active.sections
  .map(
    (s) =>
      `<section><h2>${s.title}</h2><p>${s.body}</p>${
        s.kind === 'cta' ? '<a class="cta" href="mailto:sales@example.com">Request Quote</a>' : ''
      }</section>`
  )
  .join('\n')}
</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${active.title.replace(/\s+/g, '_') || 'site'}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="max-w-[96rem] mx-auto space-y-4 animate-fade-in px-1">
      <div className="rounded-3xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 via-white to-cyan-50/50 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-emerald-700 font-black text-xs uppercase tracking-widest">
              <Code2 size={14} /> Site Builder
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">独立站 / 货源站</h2>
            <p className="text-sm text-slate-500 font-medium mt-1 max-w-2xl">
              用自然语言描述站点，右侧实时预览；可挂产品库 SKU，导出 HTML 或标记发布（询盘回灌 CRM 后续接通）。
            </p>
          </div>
          <button
            type="button"
            onClick={createBlank}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 text-white text-xs font-black px-3 py-2.5"
          >
            <Plus size={14} /> 新建项目
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-4 min-h-[28rem]">
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white overflow-hidden max-h-[36rem] flex flex-col">
          <div className="px-2 py-2 border-b text-[10px] font-black text-slate-500 uppercase">项目</div>
          <div className="flex-1 overflow-y-auto">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActiveId(p.id);
                  setSkuCodes(p.skuCodes);
                }}
                className={`w-full text-left px-2.5 py-2 text-xs border-b border-slate-50 hover:bg-slate-50 ${
                  activeId === p.id ? 'bg-emerald-50 font-black text-emerald-900' : 'text-slate-700 font-bold'
                }`}
              >
                <div className="truncate">{p.title}</div>
                <div className="text-[9px] text-slate-400 mt-0.5">
                  {p.published ? '可发布' : '草稿'} · {LOCALE_LABEL[p.locale]}
                </div>
              </button>
            ))}
            {!projects.length && <p className="text-[10px] text-slate-400 p-3 text-center">点右上角新建</p>}
          </div>
        </div>

        <div className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white flex flex-col max-h-[36rem]">
          {!active ? (
            <p className="m-auto text-sm text-slate-400 font-medium">创建或选择项目</p>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-2 items-center">
                <select
                  value={active.locale}
                  onChange={(e) => {
                    const next = {
                      ...active,
                      locale: e.target.value as SiteProject['locale'],
                      updatedAt: Date.now(),
                    };
                    persist(projects.map((p) => (p.id === active.id ? next : p)));
                  }}
                  className="rounded-lg border border-slate-200 text-xs font-bold px-2 py-1.5"
                >
                  {(Object.keys(LOCALE_LABEL) as SiteProject['locale'][]).map((k) => (
                    <option key={k} value={k}>
                      {LOCALE_LABEL[k]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={togglePublish}
                  className={`text-[10px] font-black px-2 py-1.5 rounded-lg border ${
                    active.published
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  {active.published ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 size={10} /> 已标记可发布
                    </span>
                  ) : (
                    '标记可发布'
                  )}
                </button>
                <button
                  type="button"
                  onClick={exportHtml}
                  className="text-[10px] font-black px-2 py-1.5 rounded-lg border border-slate-200"
                >
                  导出 HTML
                </button>
                <button type="button" onClick={() => remove(active.id)} className="ml-auto text-slate-300 hover:text-rose-500">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="px-3 py-2 border-b border-slate-100">
                <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
                  <Package size={10} /> 挂接产品库
                </label>
                <select
                  multiple
                  value={skuCodes}
                  onChange={(e) =>
                    setSkuCodes(Array.from(e.target.selectedOptions).map((o) => o.value))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-1.5 text-xs h-20"
                >
                  {skus.slice(0, 60).map((s) => (
                    <option key={s.id} value={s.skuCode}>
                      {s.skuCode} · {s.name}
                    </option>
                  ))}
                </select>
                <p className="text-[9px] text-slate-400 mt-1">按住 Cmd/Ctrl 多选</p>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                {active.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-emerald-600 text-white ml-6'
                        : 'bg-slate-100 text-slate-700 mr-4'
                    }`}
                  >
                    {m.text}
                  </div>
                ))}
              </div>

              <div className="p-3 border-t border-slate-100 flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void send()}
                  placeholder="描述站点，例如：欧美玩具进口商货源站，强调 CE 认证…"
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
                <button
                  type="button"
                  disabled={busy || !input.trim()}
                  onClick={() => void send()}
                  className="rounded-xl bg-emerald-600 text-white px-3 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 overflow-hidden max-h-[36rem] flex flex-col">
          <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2 text-xs font-bold text-slate-400">
            <Eye size={12} /> 实时预览
            {active && (
              <span className="ml-auto inline-flex items-center gap-1 text-cyan-400">
                <Globe size={10} /> {LOCALE_LABEL[active.locale]}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!active ? (
              <p className="text-center text-slate-500 text-sm py-20">预览区</p>
            ) : (
              active.sections.map((s, idx) => (
                <section
                  key={s.id}
                  className={`px-6 py-8 border-b border-white/5 ${idx === 0 ? 'bg-gradient-to-b from-cyan-500/10 to-transparent' : ''}`}
                >
                  <input
                    value={s.title}
                    onChange={(e) => patchSection(s.id, { title: e.target.value })}
                    className="w-full bg-transparent text-xl sm:text-2xl font-black tracking-tight text-white border-none outline-none mb-2"
                  />
                  <textarea
                    value={s.body}
                    onChange={(e) => patchSection(s.id, { body: e.target.value })}
                    rows={2}
                    className="w-full bg-transparent text-sm text-slate-300 border-none outline-none resize-none leading-relaxed"
                  />
                  {s.kind === 'cta' && (
                    <span className="inline-block mt-4 rounded-full bg-cyan-400 text-slate-950 text-xs font-black px-4 py-2">
                      Request Quote
                    </span>
                  )}
                </section>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
