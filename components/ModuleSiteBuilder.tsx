import React, { useMemo, useState } from 'react';
import {
  Code2,
  Send,
  Loader2,
  Plus,
  Trash2,
  Eye,
  Package,
  CheckCircle2,
  Download,
  Monitor,
  Smartphone,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import type { User } from '../types';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import {
  type SiteProject,
  loadSiteProjects,
  saveSiteProjects,
  newCreativeId,
} from '../services/creativeStudioStore';
import {
  SITE_TEMPLATES,
  type SiteTemplateId,
  buildSectionsFromPrompt,
  buildSitePreviewHtml,
  getTemplateMeta,
} from '../services/siteBuilderTemplates';

type Props = { currentUser: User };

const LOCALE_LABEL: Record<SiteProject['locale'], string> = {
  zh: '中文',
  en: 'English',
  es: 'Español',
  ar: 'العربية',
};

/**
 * 网站设计开发：对话描述 → 模板生成 → 实时预览（对齐「描述即构建」工作流，界面不含第三方产品名）。
 */
export const ModuleSiteBuilder: React.FC<Props> = ({ currentUser }) => {
  const [projects, setProjects] = useState<SiteProject[]>(() => loadSiteProjects());
  const [activeId, setActiveId] = useState<string | null>(projects[0]?.id || null);
  const [input, setInput] = useState('');
  const [homePrompt, setHomePrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [skuCodes, setSkuCodes] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<SiteTemplateId>('trade_hero');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const skus = useMemo(() => loadCatalogSkus(), []);
  const active = projects.find((p) => p.id === activeId) || null;

  const persist = (next: SiteProject[]) => {
    setProjects(next);
    saveSiteProjects(next);
  };

  const productLabelsFor = (codes: string[]) =>
    skus
      .filter((s) => codes.includes(s.skuCode))
      .map((s) => `${s.skuCode} ${s.nameEn || s.name}`);

  const createFromPrompt = (prompt: string, tpl: SiteTemplateId = templateId) => {
    const text = prompt.trim();
    if (!text) return;
    const now = Date.now();
    const labels = productLabelsFor(skuCodes);
    const sections = buildSectionsFromPrompt(text, labels, tpl);
    const meta = getTemplateMeta(tpl);
    const proj: SiteProject = {
      id: newCreativeId('site'),
      title: text.slice(0, 40) || meta.label,
      brief: text,
      locale: 'en',
      templateId: tpl,
      skuCodes: [...skuCodes],
      sections,
      messages: [
        {
          id: newCreativeId('m'),
          role: 'agent',
          text: `已用模板「${meta.label}」生成初稿。继续用自然语言改版，例如「首屏更简洁」「加 CE 认证卖点」「改成中文」。`,
          at: now,
        },
        {
          id: newCreativeId('m'),
          role: 'user',
          text,
          at: now + 1,
        },
        {
          id: newCreativeId('m'),
          role: 'agent',
          text: '右侧是实时预览。可切换桌面/手机宽度，满意后导出 HTML。',
          at: now + 2,
        },
      ],
      published: false,
      ownerUsername: currentUser.username,
      createdAt: now,
      updatedAt: now,
    };
    persist([proj, ...projects]);
    setActiveId(proj.id);
    setHomePrompt('');
    setInput('');
  };

  const createBlank = () => {
    createFromPrompt(
      'Modern B2B product showcase for overseas buyers — clear hero, product cards, and quote CTA.',
      templateId
    );
  };

  const send = async () => {
    if (!active || !input.trim()) return;
    const text = input.trim();
    setInput('');
    setBusy(true);
    const userMsg = { id: newCreativeId('m'), role: 'user' as const, text, at: Date.now() };
    const codes = skuCodes.length ? skuCodes : active.skuCodes;
    const labels = productLabelsFor(codes);
    const tpl = (active.templateId as SiteTemplateId) || templateId;
    // 简单意图：换模板 / 改语种
    let nextLocale = active.locale;
    let nextTpl = tpl;
    if (/中文|chinese/i.test(text)) nextLocale = 'zh';
    if (/english|英文/i.test(text)) nextLocale = 'en';
    for (const t of SITE_TEMPLATES) {
      if (text.includes(t.label) || new RegExp(t.labelEn, 'i').test(text)) {
        nextTpl = t.id;
        break;
      }
    }
    const mergedBrief = `${active.brief}\n${text}`.trim();
    const sections = buildSectionsFromPrompt(mergedBrief.slice(-500), labels, nextTpl);
    await new Promise((r) => setTimeout(r, 420));
    const agentMsg = {
      id: newCreativeId('m'),
      role: 'agent' as const,
      text: `已按你的说明更新预览（模板：${getTemplateMeta(nextTpl).label} · ${LOCALE_LABEL[nextLocale]}）。可继续微调，或导出 HTML。`,
      at: Date.now(),
    };
    const next: SiteProject = {
      ...active,
      title: text.slice(0, 40) || active.title,
      brief: mergedBrief.slice(-800),
      locale: nextLocale,
      templateId: nextTpl,
      skuCodes: codes,
      sections,
      messages: [...active.messages, userMsg, agentMsg],
      updatedAt: Date.now(),
    };
    persist(projects.map((p) => (p.id === active.id ? next : p)));
    setTemplateId(nextTpl);
    setBusy(false);
  };

  const togglePublish = () => {
    if (!active) return;
    const next = { ...active, published: !active.published, updatedAt: Date.now() };
    persist(projects.map((p) => (p.id === active.id ? next : p)));
  };

  const remove = (id: string) => {
    if (!confirm('删除该网站项目？')) return;
    const next = projects.filter((p) => p.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id || null);
  };

  const previewHtml = useMemo(() => {
    if (!active) return '';
    const codes = skuCodes.length ? skuCodes : active.skuCodes;
    return buildSitePreviewHtml({
      templateId: (active.templateId as SiteTemplateId) || 'trade_hero',
      title: active.title,
      brief: active.brief,
      locale: active.locale,
      productLabels: productLabelsFor(codes),
      sections: active.sections,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- skus stable enough via productLabelsFor
  }, [active, skuCodes, skus]);

  const exportHtml = () => {
    if (!active || !previewHtml) return;
    const blob = new Blob([previewHtml], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${active.title.replace(/\s+/g, '_') || 'site'}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const applyTemplate = (id: SiteTemplateId) => {
    setTemplateId(id);
    if (!active) return;
    const codes = skuCodes.length ? skuCodes : active.skuCodes;
    const sections = buildSectionsFromPrompt(active.brief || active.title, productLabelsFor(codes), id);
    const next: SiteProject = {
      ...active,
      templateId: id,
      sections,
      messages: [
        ...active.messages,
        {
          id: newCreativeId('m'),
          role: 'agent',
          text: `已切换到模板「${getTemplateMeta(id).label}」。`,
          at: Date.now(),
        },
      ],
      updatedAt: Date.now(),
    };
    persist(projects.map((p) => (p.id === active.id ? next : p)));
  };

  /* —— Lovable 式空态：大提示词 + 模板墙 —— */
  if (!active) {
    return (
      <div className="max-w-[96rem] mx-auto animate-fade-in px-1 space-y-6">
        <div className="relative overflow-hidden rounded-[2rem] border border-slate-800 bg-[#070b14] text-slate-100 shadow-xl">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(45,212,191,0.25), transparent), radial-gradient(ellipse 40% 40% at 90% 60%, rgba(56,189,248,0.12), transparent)',
            }}
          />
          <div className="relative px-5 sm:px-10 pt-10 pb-8 sm:pt-14 sm:pb-12 text-center space-y-5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-teal-200/90">
              <Sparkles size={12} /> Web Studio
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white max-w-3xl mx-auto leading-[1.1]">
              网站设计开发
            </h2>
            <p className="text-sm sm:text-base text-slate-400 font-medium max-w-xl mx-auto leading-relaxed">
              用自然语言描述你想要的站点。选一个内置模板，实时预览，迭代到满意后导出 HTML。
            </p>

            <div className="max-w-2xl mx-auto text-left rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-2 sm:p-2.5 shadow-2xl">
              <textarea
                value={homePrompt}
                onChange={(e) => setHomePrompt(e.target.value)}
                rows={3}
                placeholder="例如：给欧美玩具进口商做货源站，强调 CE / ASTM，首屏大气，带产品卡片和询盘按钮…"
                className="w-full bg-transparent text-sm sm:text-base text-white placeholder:text-slate-500 px-3 py-2 resize-none outline-none min-h-[5.5rem]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    createFromPrompt(homePrompt);
                  }
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1">
                <span className="text-[10px] font-bold text-slate-500">⌘/Ctrl + Enter 生成</span>
                <button
                  type="button"
                  disabled={!homePrompt.trim()}
                  onClick={() => createFromPrompt(homePrompt)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-slate-950 text-xs font-black px-4 py-2.5 disabled:opacity-40"
                >
                  开始构建 <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-end justify-between gap-3 mb-3 px-1">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">内置模板</div>
              <p className="text-sm font-bold text-slate-700 mt-0.5">先选风格，再描述需求</p>
            </div>
            <button
              type="button"
              onClick={createBlank}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-black px-3 py-2 hover:bg-slate-50"
            >
              <Plus size={14} /> 空白项目
            </button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {SITE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTemplateId(t.id);
                  if (homePrompt.trim()) createFromPrompt(homePrompt, t.id);
                }}
                className={`text-left rounded-2xl border overflow-hidden transition-all ${
                  templateId === t.id
                    ? 'border-teal-500 ring-2 ring-teal-100'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="h-24" style={{ background: t.swatch }} />
                <div className="p-3 bg-white">
                  <div className="text-xs font-black text-slate-900">{t.label}</div>
                  <div className="text-[10px] text-slate-400 font-bold mt-0.5">{t.labelEn}</div>
                  <p className="text-[11px] text-slate-500 font-medium mt-1.5 leading-snug">{t.blurb}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {projects.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-black text-slate-700 mb-2">最近项目</div>
            <div className="flex flex-wrap gap-2">
              {projects.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setActiveId(p.id);
                    setSkuCodes(p.skuCodes);
                    if (p.templateId) setTemplateId(p.templateId as SiteTemplateId);
                  }}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  {p.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* —— 对话 + 预览分栏 —— */
  return (
    <div className="max-w-[96rem] mx-auto space-y-3 animate-fade-in px-1">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-teal-300">
            <Code2 size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-teal-700">网站设计开发</div>
            <div className="text-sm font-extrabold text-slate-900 truncate">{active.title}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeId || ''}
            onChange={(e) => {
              const id = e.target.value;
              setActiveId(id);
              const p = projects.find((x) => x.id === id);
              if (p) {
                setSkuCodes(p.skuCodes);
                if (p.templateId) setTemplateId(p.templateId as SiteTemplateId);
              }
            }}
            className="rounded-lg border border-slate-200 text-xs font-bold px-2 py-1.5 max-w-[10rem]"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title.slice(0, 24)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setActiveId(null)}
            className="rounded-lg border border-slate-200 text-xs font-black px-2.5 py-1.5 hover:bg-slate-50"
          >
            <Plus size={12} className="inline mr-1" /> 新项目
          </button>
          <button
            type="button"
            onClick={togglePublish}
            className={`text-[10px] font-black px-2.5 py-1.5 rounded-lg border ${
              active.published
                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}
          >
            {active.published ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={10} /> 可发布
              </span>
            ) : (
              '标记可发布'
            )}
          </button>
          <button
            type="button"
            onClick={exportHtml}
            className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
          >
            <Download size={12} /> 导出 HTML
          </button>
          <button type="button" onClick={() => remove(active.id)} className="text-slate-300 hover:text-rose-500 p-1">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-3 min-h-[32rem]">
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white flex flex-col max-h-[40rem]">
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
            <select
              value={(active.templateId as SiteTemplateId) || templateId}
              onChange={(e) => applyTemplate(e.target.value as SiteTemplateId)}
              className="rounded-lg border border-slate-200 text-xs font-bold px-2 py-1.5 flex-1 min-w-0"
            >
              {SITE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="px-3 py-2 border-b border-slate-100">
            <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1">
              <Package size={10} /> 产品库 SKU
            </label>
            <select
              multiple
              value={skuCodes}
              onChange={(e) => setSkuCodes(Array.from(e.target.selectedOptions).map((o) => o.value))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-1.5 text-xs h-16"
            >
              {skus.slice(0, 60).map((s) => (
                <option key={s.id} value={s.skuCode}>
                  {s.skuCode} · {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {active.messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-slate-900 text-white ml-4'
                    : 'bg-slate-100 text-slate-700 mr-2'
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
              placeholder="继续描述改动，如：首屏更大胆、加认证徽章…"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            />
            <button
              type="button"
              disabled={busy || !input.trim()}
              onClick={() => void send()}
              className="rounded-xl bg-teal-600 hover:bg-teal-500 text-white px-3 disabled:opacity-50"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
            </button>
          </div>
        </div>

        <div className="lg:col-span-8 rounded-2xl border border-slate-800 bg-[#0b1220] overflow-hidden max-h-[40rem] flex flex-col">
          <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2 text-xs font-bold text-slate-400">
            <Eye size={12} /> 实时预览
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setViewport('desktop')}
                className={`p-1.5 rounded-lg ${viewport === 'desktop' ? 'bg-white/10 text-teal-300' : 'hover:bg-white/5'}`}
                title="桌面"
              >
                <Monitor size={14} />
              </button>
              <button
                type="button"
                onClick={() => setViewport('mobile')}
                className={`p-1.5 rounded-lg ${viewport === 'mobile' ? 'bg-white/10 text-teal-300' : 'hover:bg-white/5'}`}
                title="手机"
              >
                <Smartphone size={14} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden bg-slate-950/80 flex justify-center p-3 sm:p-4">
            <div
              className={`h-full bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10 transition-all ${
                viewport === 'mobile' ? 'w-[375px] max-w-full' : 'w-full'
              }`}
            >
              <iframe
                title="site-preview"
                srcDoc={previewHtml}
                className="w-full h-full border-0 bg-white"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
