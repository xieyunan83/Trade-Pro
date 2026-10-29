import React, { useEffect, useMemo, useState } from 'react';
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
  BookOpen,
  X,
  Rocket,
  Link2,
  ShieldCheck,
  HardDrive,
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
import { SiteTemplateThumb } from './SiteTemplateThumb';
import {
  BACKEND_OPTIONS,
  DATABASE_OPTIONS,
  DEFAULT_STACK,
  DEPLOY_OPTIONS,
  FRONTEND_OPTIONS,
  getDeployOption,
  getStackOption,
  type DeployOption,
  type StackOption,
} from '../services/siteStackCatalog';
import {
  analyzeReferenceFromPrompt,
  applyChatEditsToBrief,
} from '../services/siteReferenceAnalyze';
import { deleteSiteHtml, getSiteHtml, putSiteHtml } from '../services/siteProjectVault';

type Props = { currentUser: User };

const LOCALE_LABEL: Record<SiteProject['locale'], string> = {
  zh: '中文',
  en: 'English',
  es: 'Español',
  ar: 'العربية',
};

const URL_RE_STRIP = /https?:\/\/[^\s]+/gi;

const OptionCard: React.FC<{
  opt: StackOption | DeployOption;
  selected: boolean;
  onSelect: () => void;
  badge?: string;
}> = ({ opt, selected, onSelect, badge }) => (
  <button
    type="button"
    onClick={onSelect}
    className={`text-left rounded-xl border p-3 transition-all ${
      selected
        ? 'border-teal-500 ring-2 ring-teal-100 bg-teal-50/40'
        : 'border-slate-200 bg-white hover:border-slate-300'
    }`}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="text-xs font-black text-slate-900">{opt.label}</div>
      {badge ? (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
          {badge}
        </span>
      ) : null}
    </div>
    <p className="text-[11px] text-slate-500 mt-1 leading-snug">{opt.blurb}</p>
    <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
      <div>
        <div className="font-black text-emerald-700 mb-0.5">利</div>
        <ul className="space-y-0.5 text-slate-600">
          {opt.pros.slice(0, 2).map((p) => (
            <li key={p}>· {p}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="font-black text-amber-700 mb-0.5">弊</div>
        <ul className="space-y-0.5 text-slate-600">
          {opt.cons.slice(0, 2).map((c) => (
            <li key={c}>· {c}</li>
          ))}
        </ul>
      </div>
    </div>
    <p className="mt-2 text-[10px] font-bold text-slate-400">适合：{opt.bestFor}</p>
  </button>
);

/**
 * 网站设计开发：Vibe Coding 快速设计 → 选型 → 参考 URL → 对话迭代 → 本机双备份 → 推送上线
 */
export const ModuleSiteBuilder: React.FC<Props> = ({ currentUser }) => {
  const [projects, setProjects] = useState<SiteProject[]>(() => loadSiteProjects());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [homePrompt, setHomePrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [skuCodes, setSkuCodes] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<SiteTemplateId>('trade_hero');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [deployOpen, setDeployOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [frontendId, setFrontendId] = useState<string>(DEFAULT_STACK.frontendId);
  const [backendId, setBackendId] = useState<string>(DEFAULT_STACK.backendId);
  const [databaseId, setDatabaseId] = useState<string>(DEFAULT_STACK.databaseId);
  const [deployId, setDeployId] = useState<string>(DEFAULT_STACK.deployId);
  const [vaultHtml, setVaultHtml] = useState<string | null>(null);
  const [persistHint, setPersistHint] = useState('');
  const skus = useMemo(() => loadCatalogSkus(), []);
  const active = projects.find((p) => p.id === activeId) || null;
  const deployMeta = getDeployOption(active?.deployId || deployId);

  const persistMeta = (next: SiteProject[]) => {
    setProjects(next);
    saveSiteProjects(next);
  };

  const persistProjectHtml = async (proj: SiteProject, html: string) => {
    try {
      await putSiteHtml(proj.id, html, proj.title);
      setPersistHint('本机已双备份（浏览器站点库 + 会话兜底）');
      return true;
    } catch {
      setPersistHint('本机备份失败，请立刻导出 HTML 以免丢失');
      return false;
    }
  };

  const productLabelsFor = (codes: string[]) =>
    skus
      .filter((s) => codes.includes(s.skuCode))
      .map((s) => `${s.skuCode} ${s.nameEn || s.name}`);

  const buildHtmlFor = (proj: SiteProject, codes: string[]) =>
    buildSitePreviewHtml({
      templateId: (proj.templateId as SiteTemplateId) || 'trade_hero',
      title: proj.title,
      brief: proj.brief,
      locale: proj.locale,
      productLabels: productLabelsFor(codes),
      sections: proj.sections,
    });

  const createFromPrompt = async (prompt: string, tpl?: SiteTemplateId) => {
    const text = prompt.trim();
    if (!text) return;
    const ref = analyzeReferenceFromPrompt(text);
    const useTpl = tpl || ref.suggestedTemplate || templateId;
    const now = Date.now();
    const labels = productLabelsFor(skuCodes);
    const brief = [text, ref.briefAugment].filter(Boolean).join('\n');
    const sections = buildSectionsFromPrompt(brief, labels, useTpl);
    const meta = getTemplateMeta(useTpl);
    const id = newCreativeId('site');
    const proj: SiteProject = {
      id,
      title: (ref.host ? `${ref.host} · ` : '') + text.replace(URL_RE_STRIP, '').trim().slice(0, 36) || meta.label,
      brief,
      locale: 'en',
      templateId: useTpl,
      referenceUrl: ref.url || undefined,
      referenceNotes: ref.styleNotes.join('；') || undefined,
      frontendId,
      backendId,
      databaseId,
      deployId,
      htmlPersisted: false,
      skuCodes: [...skuCodes],
      sections,
      messages: [
        {
          id: newCreativeId('m'),
          role: 'agent',
          text: `Vibe 初稿已生成（模板「${meta.label}」）。${
            ref.url ? `已参考 ${ref.host || ref.url}。` : ''
          }像聊天一样告诉我要改什么；满意后点「推送上线」。站点会写入本机备份，不会因刷新突然消失。`,
          at: now,
        },
        { id: newCreativeId('m'), role: 'user', text, at: now + 1 },
        {
          id: newCreativeId('m'),
          role: 'agent',
          text: `选型：前端 ${getStackOption(FRONTEND_OPTIONS, frontendId)?.label} · 后台 ${getStackOption(BACKEND_OPTIONS, backendId)?.label} · 数据库 ${getStackOption(DATABASE_OPTIONS, databaseId)?.label} · 部署 ${getDeployOption(deployId)?.label}`,
          at: now + 2,
        },
      ],
      published: false,
      ownerUsername: currentUser.username,
      createdAt: now,
      updatedAt: now,
    };
    const html = buildHtmlFor(proj, proj.skuCodes);
    const ok = await persistProjectHtml(proj, html);
    proj.htmlPersisted = ok;
    persistMeta([proj, ...projects]);
    setActiveId(proj.id);
    setTemplateId(useTpl);
    setHomePrompt('');
    setInput('');
    setVaultHtml(html);
  };

  const createBlank = () => {
    void createFromPrompt(
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
    let nextLocale = active.locale;
    let nextTpl = (active.templateId as SiteTemplateId) || templateId;
    if (/中文|chinese/i.test(text)) nextLocale = 'zh';
    if (/english|英文/i.test(text)) nextLocale = 'en';
    for (const t of SITE_TEMPLATES) {
      if (text.includes(t.label) || new RegExp(t.labelEn, 'i').test(text)) {
        nextTpl = t.id;
        break;
      }
    }
    const ref = analyzeReferenceFromPrompt(text);
    if (ref.url && ref.suggestedTemplate) nextTpl = ref.suggestedTemplate;
    const mergedBrief = applyChatEditsToBrief(
      active.brief,
      text,
      ref.briefAugment || active.referenceNotes
    );
    const sections = buildSectionsFromPrompt(mergedBrief.slice(-600), labels, nextTpl);
    await new Promise((r) => setTimeout(r, 280));
    const agentMsg = {
      id: newCreativeId('m'),
      role: 'agent' as const,
      text: `已按你的说明改好预览（${getTemplateMeta(nextTpl).label} · ${LOCALE_LABEL[nextLocale]}）。${
        ref.url ? `并纳入参考 ${ref.host || '链接'}。` : ''
      }继续说改动，或点「推送上线」。`,
      at: Date.now(),
    };
    const next: SiteProject = {
      ...active,
      title: text.replace(URL_RE_STRIP, '').trim().slice(0, 40) || active.title,
      brief: mergedBrief,
      locale: nextLocale,
      templateId: nextTpl,
      referenceUrl: ref.url || active.referenceUrl,
      referenceNotes: ref.styleNotes.length
        ? ref.styleNotes.join('；')
        : active.referenceNotes,
      skuCodes: codes,
      sections,
      messages: [...active.messages, userMsg, agentMsg],
      updatedAt: Date.now(),
    };
    const html = buildHtmlFor(next, codes);
    next.htmlPersisted = await persistProjectHtml(next, html);
    persistMeta(projects.map((p) => (p.id === active.id ? next : p)));
    setVaultHtml(html);
    setTemplateId(nextTpl);
    setBusy(false);
  };

  const remove = async (id: string) => {
    if (!confirm('删除该网站项目？本机备份也会清除。')) return;
    await deleteSiteHtml(id);
    const next = projects.filter((p) => p.id !== id);
    persistMeta(next);
    if (activeId === id) {
      setActiveId(null);
      setVaultHtml(null);
    }
  };

  const previewHtml = useMemo(() => {
    if (!active) return vaultHtml || '';
    const codes = skuCodes.length ? skuCodes : active.skuCodes;
    return buildHtmlFor(active, codes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, skuCodes, skus]);

  useEffect(() => {
    if (!active?.id || !previewHtml) return;
    const id = active.id;
    const title = active.title;
    void putSiteHtml(id, previewHtml, title).then(() => {
      setVaultHtml(previewHtml);
      setPersistHint('本机已双备份（浏览器站点库 + 会话兜底）');
      setProjects((prev) => {
        const cur = prev.find((p) => p.id === id);
        if (!cur || cur.htmlPersisted) return prev;
        const next = prev.map((p) => (p.id === id ? { ...p, htmlPersisted: true } : p));
        saveSiteProjects(next);
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autosave by html fingerprint
  }, [previewHtml, active?.id]);

  useEffect(() => {
    if (!activeId) return;
    void getSiteHtml(activeId).then((h) => {
      if (h) setVaultHtml(h);
    });
  }, [activeId]);

  const exportHtml = () => {
    const html = previewHtml || vaultHtml;
    if (!active || !html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'index.html';
    a.click();
    URL.revokeObjectURL(a.href);
    void persistProjectHtml(active, html);
  };

  const pushPublish = async () => {
    if (!active) return;
    const html = previewHtml || vaultHtml || '';
    if (!html) return;
    await persistProjectHtml(active, html);
    const next: SiteProject = {
      ...active,
      published: true,
      htmlPersisted: true,
      lastPublishedAt: Date.now(),
      updatedAt: Date.now(),
      messages: [
        ...active.messages,
        {
          id: newCreativeId('m'),
          role: 'agent',
          text: `已标记推送并完成本机备份。请按「${deployMeta?.label || '所选部署'}」步骤上线；导出的 index.html 不会因关闭页面丢失。`,
          at: Date.now(),
        },
      ],
    };
    persistMeta(projects.map((p) => (p.id === active.id ? next : p)));
    exportHtml();
    setPublishOpen(true);
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
    persistMeta(projects.map((p) => (p.id === active.id ? next : p)));
  };

  const stackReady = !!(frontendId && backendId && databaseId && deployId);

  const publishPanel =
    publishOpen && deployMeta ? (
      <div
        className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-950/50 backdrop-blur-sm p-3"
        role="dialog"
        onClick={() => setPublishOpen(false)}
      >
        <div
          className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-white">
            <div className="flex items-center gap-2">
              <Rocket size={16} className="text-teal-600" />
              <div>
                <div className="text-sm font-extrabold text-slate-900">推送上线 · {deployMeta.label}</div>
                <p className="text-[10px] text-slate-500">index.html 已导出并写入本机备份</p>
              </div>
            </div>
            <button type="button" onClick={() => setPublishOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
              <X size={16} />
            </button>
          </div>
          <div className="px-4 py-4 space-y-3">
            <p className="text-xs text-slate-600 leading-relaxed">{deployMeta.blurb}</p>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2">
                <div className="font-black text-emerald-800 mb-1">优势</div>
                <ul className="space-y-0.5 text-emerald-900/80">
                  {deployMeta.pros.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-100 p-2">
                <div className="font-black text-amber-800 mb-1">注意</div>
                <ul className="space-y-0.5 text-amber-900/80">
                  {deployMeta.cons.map((c) => (
                    <li key={c}>· {c}</li>
                  ))}
                </ul>
              </div>
            </div>
            <ol className="list-decimal pl-4 text-xs space-y-1.5 text-slate-700">
              {deployMeta.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600 flex gap-2">
              <ShieldCheck size={14} className="text-teal-600 shrink-0 mt-0.5" />
              本平台项目元数据在本地；完整 HTML 另存浏览器站点库。清浏览器数据前请先导出备份。
            </div>
          </div>
        </div>
      </div>
    ) : null;

  const deployCatalogModal =
    deployOpen ? (
      <div
        className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-950/50 backdrop-blur-sm p-3"
        role="dialog"
        onClick={() => setDeployOpen(false)}
      >
        <div
          className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b bg-white">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-teal-600" />
              <div>
                <div className="text-sm font-extrabold">部署方案百科</div>
                <p className="text-[10px] text-slate-500">本机 · 国内云 · 国际（含本平台常用上线链路）</p>
              </div>
            </div>
            <button type="button" onClick={() => setDeployOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
              <X size={16} />
            </button>
          </div>
          <div className="p-4 grid sm:grid-cols-2 gap-3">
            {DEPLOY_OPTIONS.map((d) => (
              <OptionCard
                key={d.id}
                opt={d}
                selected={deployId === d.id}
                onSelect={() => {
                  setDeployId(d.id);
                  if (active) {
                    persistMeta(
                      projects.map((p) =>
                        p.id === active.id ? { ...p, deployId: d.id, updatedAt: Date.now() } : p
                      )
                    );
                  }
                }}
                badge={d.region === 'cn' ? '国内' : d.region === 'local' ? '本机' : '国际'}
              />
            ))}
          </div>
        </div>
      </div>
    ) : null;

  /* —— 空态：选型 + 提示词 + 模板 —— */
  if (!active) {
    return (
      <div className="max-w-[96rem] mx-auto animate-fade-in px-1 space-y-5">
        {deployCatalogModal}
        <div className="relative overflow-hidden rounded-[2rem] border border-slate-800 bg-[#070b14] text-slate-100 shadow-xl">
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(45,212,191,0.28), transparent), radial-gradient(ellipse 40% 40% at 88% 55%, rgba(56,189,248,0.14), transparent)',
            }}
          />
          <div className="relative px-5 sm:px-10 pt-10 pb-8 space-y-5 text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-teal-200/90">
                <Sparkles size={12} /> Vibe Coding · Web Studio
              </div>
              <button
                type="button"
                onClick={() => setDeployOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 text-[10px] font-black text-teal-200 hover:bg-teal-400/20"
              >
                <BookOpen size={11} /> 部署方案百科
              </button>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white max-w-3xl mx-auto leading-[1.1]">
              网站设计开发
            </h2>
            <p className="text-sm text-slate-400 font-medium max-w-2xl mx-auto leading-relaxed">
              用自然语言快速出站。可粘贴参考网址做风格借鉴；建站前选定前端 / 后台 / 数据库与部署目标；对话改版后一键推送上线。站点写入本机双备份，避免突然消失。
            </p>

            <div className="max-w-2xl mx-auto text-left rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-2.5 shadow-2xl">
              <div className="flex items-center gap-1.5 px-3 pt-1 text-[10px] font-bold text-teal-200/80">
                <Link2 size={11} /> 支持粘贴 https://… 参考或仿作
              </div>
              <textarea
                value={homePrompt}
                onChange={(e) => setHomePrompt(e.target.value)}
                rows={3}
                placeholder="例如：参考 https://example.com 给欧美玩具进口商做货源站，强调 CE / ASTM，首屏大气，带产品卡片和询盘…"
                className="w-full bg-transparent text-sm sm:text-base text-white placeholder:text-slate-500 px-3 py-2 resize-none outline-none min-h-[5.5rem]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && stackReady) {
                    e.preventDefault();
                    void createFromPrompt(homePrompt);
                  }
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1">
                <span className="text-[10px] font-bold text-slate-500">
                  {stackReady ? '⌘/Ctrl + Enter 生成' : '请先完成下方技术选型'}
                </span>
                <button
                  type="button"
                  disabled={!homePrompt.trim() || !stackReady || busy}
                  onClick={() => void createFromPrompt(homePrompt)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-slate-950 text-xs font-black px-4 py-2.5 disabled:opacity-40"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                  开始构建 <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">建站前选型</div>
              <p className="text-sm font-bold text-slate-800 mt-0.5">前端 · 后台 · 数据库 · 部署（含利弊）</p>
            </div>
            <span className="text-[10px] font-bold text-slate-400 inline-flex items-center gap-1">
              <HardDrive size={12} /> 生成后自动本机备份
            </span>
          </div>

          <div>
            <div className="text-[11px] font-black text-slate-600 mb-2">① 前端</div>
            <div className="grid sm:grid-cols-3 gap-2">
              {FRONTEND_OPTIONS.map((o) => (
                <OptionCard key={o.id} opt={o} selected={frontendId === o.id} onSelect={() => setFrontendId(o.id)} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-black text-slate-600 mb-2">② 后台</div>
            <div className="grid sm:grid-cols-3 gap-2">
              {BACKEND_OPTIONS.map((o) => (
                <OptionCard key={o.id} opt={o} selected={backendId === o.id} onSelect={() => setBackendId(o.id)} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-black text-slate-600 mb-2">③ 数据库</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {DATABASE_OPTIONS.map((o) => (
                <OptionCard key={o.id} opt={o} selected={databaseId === o.id} onSelect={() => setDatabaseId(o.id)} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-black text-slate-600 mb-2">④ 部署目标</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {DEPLOY_OPTIONS.map((o) => (
                <OptionCard
                  key={o.id}
                  opt={o}
                  selected={deployId === o.id}
                  onSelect={() => setDeployId(o.id)}
                  badge={o.region === 'cn' ? '国内' : o.region === 'local' ? '本机' : '国际'}
                />
              ))}
            </div>
          </div>
        </section>

        <div>
          <div className="flex items-end justify-between gap-3 mb-3 px-1">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vibe 模板</div>
              <p className="text-sm font-bold text-slate-700 mt-0.5">先选风格，再描述需求（可粘贴参考链接）</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDeployOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 text-teal-800 text-xs font-black px-3 py-2"
              >
                <BookOpen size={14} /> 部署百科
              </button>
              <button
                type="button"
                disabled={!stackReady}
                onClick={createBlank}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-black px-3 py-2 hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus size={14} /> 空白项目
              </button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {SITE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTemplateId(t.id);
                  if (homePrompt.trim() && stackReady) void createFromPrompt(homePrompt, t.id);
                }}
                className={`text-left rounded-2xl border overflow-hidden transition-all bg-white ${
                  templateId === t.id
                    ? 'border-teal-500 ring-2 ring-teal-100 shadow-md'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <SiteTemplateThumb id={t.id} accent={t.accent} />
                <div className="p-3 border-t border-slate-100">
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
            <div className="text-xs font-black text-slate-700 mb-2">最近项目（本机保留）</div>
            <div className="flex flex-wrap gap-2">
              {projects.slice(0, 12).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setActiveId(p.id);
                    setSkuCodes(p.skuCodes);
                    if (p.templateId) setTemplateId(p.templateId as SiteTemplateId);
                    if (p.frontendId) setFrontendId(p.frontendId);
                    if (p.backendId) setBackendId(p.backendId);
                    if (p.databaseId) setDatabaseId(p.databaseId);
                    if (p.deployId) setDeployId(p.deployId);
                  }}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  {p.title}
                  {p.published ? ' · 已推送' : ''}
                  {p.htmlPersisted ? ' · 已备份' : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* —— 对话 + 预览 —— */
  return (
    <div className="max-w-[96rem] mx-auto space-y-3 animate-fade-in px-1">
      {deployCatalogModal}
      {publishPanel}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-teal-300">
            <Code2 size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-teal-700">
              Vibe · 网站设计开发
            </div>
            <div className="text-sm font-extrabold text-slate-900 truncate">{active.title}</div>
            <div className="text-[10px] text-slate-400 font-medium truncate">
              {getStackOption(FRONTEND_OPTIONS, active.frontendId)?.label} ·{' '}
              {getDeployOption(active.deployId)?.label}
              {active.referenceUrl ? ` · 参考 ${active.referenceUrl}` : ''}
              {persistHint ? ` · ${persistHint}` : active.htmlPersisted ? ' · 本机已备份' : ''}
            </div>
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
            onClick={() => setDeployOpen(true)}
            className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-1.5 rounded-lg border border-teal-200 bg-teal-50 text-teal-800"
          >
            <BookOpen size={12} /> 部署百科
          </button>
          <button
            type="button"
            onClick={() => void pushPublish()}
            className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
          >
            <Rocket size={12} /> 推送上线
          </button>
          {active.published ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200">
              <CheckCircle2 size={10} /> 已推送
            </span>
          ) : null}
          <button
            type="button"
            onClick={exportHtml}
            className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
          >
            <Download size={12} /> 导出 HTML
          </button>
          <button type="button" onClick={() => void remove(active.id)} className="text-slate-300 hover:text-rose-500 p-1">
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
                persistMeta(projects.map((p) => (p.id === active.id ? next : p)));
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
                  m.role === 'user' ? 'bg-slate-900 text-white ml-4' : 'bg-slate-100 text-slate-700 mr-2'
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
              placeholder="继续说改动，或粘贴参考链接…"
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
              >
                <Monitor size={14} />
              </button>
              <button
                type="button"
                onClick={() => setViewport('mobile')}
                className={`p-1.5 rounded-lg ${viewport === 'mobile' ? 'bg-white/10 text-teal-300' : 'hover:bg-white/5'}`}
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
                srcDoc={previewHtml || vaultHtml || ''}
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
