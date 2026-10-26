import React, { useEffect, useMemo, useState } from 'react';
import type { Client, HistoryItem, MailGroup } from '../types';
import { ModuleType } from '../types';
import {
  runGtmLaunchPack,
  suggestGtmInputFromCreative,
} from '../services/gtmExpertService';
import {
  loadGtmLaunchPacks,
  type GtmClientMatch,
  type GtmLaunchPack,
} from '../services/gtmExpertStore';
import { CreativePipelineBar } from './CreativeRefPicker';
import {
  Search,
  Loader2,
  Target,
  Sparkles,
  Globe2,
  Briefcase,
  Mail,
  Copy,
  CheckCircle2,
  ExternalLink,
  Compass,
} from 'lucide-react';

interface ModuleProductMatchProps {
  history: HistoryItem[];
  crmClients: Client[];
  onOpenHistory?: (item: HistoryItem) => void;
  onGoCrm?: () => void;
  onNavigateModule?: (mod: ModuleType) => void;
}

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

const MailGroupCard: React.FC<{ title: string; group: MailGroup }> = ({ title, group }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const rows = [
    { k: '1', subject: group.subject1, body: group.email1 },
    { k: '2', subject: group.subject2, body: group.email2 },
    { k: '3', subject: group.subject3, body: group.email3 },
  ];
  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-3">
      <div className="flex items-center gap-2 font-black text-slate-800 text-sm">
        <Mail size={14} className="text-indigo-600" />
        {title}
      </div>
      {group.analysis && (
        <p className="text-xs text-slate-600 font-medium leading-relaxed">{group.analysis}</p>
      )}
      {group.sendTip && (
        <p className="text-[11px] text-indigo-700 font-bold">发送提示：{group.sendTip}</p>
      )}
      {rows.map((r) => (
        <div key={r.k} className="bg-white rounded-xl border border-slate-200 p-3 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[11px] font-black text-slate-500">
              Email {r.k}
              {r.subject ? ` · ${r.subject}` : ''}
            </div>
            <button
              type="button"
              className="text-[10px] font-bold text-indigo-600 inline-flex items-center gap-1"
              onClick={async () => {
                const ok = await copyText(
                  `${r.subject ? `Subject: ${r.subject}\n\n` : ''}${r.body || ''}`
                );
                if (ok) {
                  setCopied(r.k);
                  setTimeout(() => setCopied(null), 1500);
                }
              }}
            >
              {copied === r.k ? <CheckCircle2 size={12} /> : <Copy size={12} />}
              {copied === r.k ? '已复制' : '复制'}
            </button>
          </div>
          <pre className="text-[11px] text-slate-700 whitespace-pre-wrap font-sans leading-relaxed max-h-40 overflow-y-auto">
            {r.body}
          </pre>
        </div>
      ))}
    </div>
  );
};

/**
 * 市调专家 + 产品经理 → 国家/客户匹配 → 专业开发信组
 */
export const ModuleProductMatch: React.FC<ModuleProductMatchProps> = ({
  history,
  crmClients,
  onOpenHistory,
  onGoCrm,
  onNavigateModule,
}) => {
  const suggested = useMemo(() => suggestGtmInputFromCreative(), []);
  const [name, setName] = useState(suggested.productName || '');
  const [category, setCategory] = useState(suggested.category || '');
  const [priceBand, setPriceBand] = useState(suggested.priceBand || '');
  const [skuCode, setSkuCode] = useState(suggested.skuCode || '');
  const [notes, setNotes] = useState(suggested.notes || suggested.designNotes || '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pack, setPack] = useState<GtmLaunchPack | null>(() => loadGtmLaunchPacks()[0] || null);
  const [expandedMail, setExpandedMail] = useState<string | null>(null);

  useEffect(() => {
    const s = suggestGtmInputFromCreative();
    if (s.productName && !name) setName(s.productName);
    if (s.category && !category) setCategory(s.category);
    if (s.skuCode && !skuCode) setSkuCode(s.skuCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openHistoryFor = (m: GtmClientMatch) => {
    if (!m.historyId || !onOpenHistory) return;
    const item = history.find((h) => h.id === m.historyId);
    if (item) onOpenHistory(item);
  };

  const run = async () => {
    if (!name.trim()) {
      setError('请填写新品名称');
      return;
    }
    setBusy(true);
    setError(null);
    setProgress('启动双专家…');
    try {
      const next = await runGtmLaunchPack({
        input: {
          productName: name.trim(),
          category: category.trim() || undefined,
          priceBand: priceBand.trim() || undefined,
          skuCode: skuCode.trim() || undefined,
          notes: notes.trim() || undefined,
          designNotes: notes.trim() || undefined,
        },
        crmClients,
        history,
        mailTopN: 3,
        onProgress: (_pct, label) => setProgress(label),
      });
      setPack(next);
      setExpandedMail(next.matches.find((m) => m.mailGroup)?.companyName || null);
    } catch (e: any) {
      setError(e?.message || '编排失败，请稍后重试');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CreativePipelineBar current="match" onNavigate={onNavigateModule} />
        {onNavigateModule && (
          <button
            type="button"
            onClick={() => onNavigateModule(ModuleType.PRODUCT_DESIGN_2D)}
            className="text-[11px] font-bold text-violet-700 hover:underline"
          >
            回平面设计补充视觉
          </button>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 text-slate-900 font-black text-xl">
              <Target className="text-emerald-600" size={22} />
              市调 · 匹配 · 开发信
            </div>
            <p className="text-sm text-slate-500 font-medium mt-1 max-w-2xl leading-relaxed">
              两位专家协同：全球市调定国家与趋势，产品经理定定位与设计要点；再匹配 CRM /
              背调客户库，并生成可复制的专业开发信组。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] font-black">
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 text-cyan-800 px-2.5 py-1 border border-cyan-100">
              <Compass size={12} /> 市调专家
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-800 px-2.5 py-1 border border-violet-100">
              <Briefcase size={12} /> 产品经理
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          <label className="block sm:col-span-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              新品名称 *
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：1:64 合金回力消防车"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              货号 SKU
            </span>
            <input
              value={skuCode}
              onChange={(e) => setSkuCode(e.target.value)}
              placeholder="可选"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">品类</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="合金/回力车玩具"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              价格带
            </span>
            <input
              value={priceBand}
              onChange={(e) => setPriceBand(e.target.value)}
              placeholder="例如 FOB $1.2–2.5"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
            />
          </label>
          <label className="block sm:col-span-2 lg:col-span-1">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              卖点 / 设计备注
            </span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="开窗礼盒、可充电、适合会展…"
              className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run()}
            className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-bold text-sm"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? progress || '专家工作中…' : '双专家分析并匹配'}
          </button>
          {onGoCrm && (
            <button
              type="button"
              onClick={onGoCrm}
              className="text-xs font-bold text-emerald-700 hover:underline"
            >
              去客户库补充线索
            </button>
          )}
          <span className="text-[11px] text-slate-400 font-medium">
            CRM {crmClients.length} 家 · 背调历史 {history.length} 条
          </span>
        </div>
        {error && (
          <p className="mt-3 text-sm font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {pack && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="bg-white rounded-3xl border border-cyan-100 shadow-sm p-5 space-y-3">
              <h3 className="font-black text-slate-900 flex items-center gap-2">
                <Globe2 className="text-cyan-600" size={18} /> 市调专家 · 国家与趋势
              </h3>
              <ul className="space-y-2">
                {pack.market.countries.slice(0, 8).map((c) => (
                  <li
                    key={c.name}
                    className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-sm text-slate-800">{c.name}</span>
                      <span className="text-[10px] font-black text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-full">
                        P{c.priority}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 font-medium mt-1 leading-relaxed">
                      {c.reasons.join('；')}
                    </p>
                    {c.channels?.length > 0 && (
                      <p className="text-[10px] text-slate-400 font-bold mt-1">
                        渠道：{c.channels.join(' · ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {pack.market.trends?.length > 0 && (
                <div className="text-xs text-slate-600 font-medium">
                  <span className="font-black text-slate-800">趋势：</span>
                  {pack.market.trends.join('；')}
                </div>
              )}
              {pack.market.designImplications?.length > 0 && (
                <div className="rounded-xl bg-cyan-50 border border-cyan-100 px-3 py-2 text-xs text-cyan-900 font-medium space-y-1">
                  <div className="font-black">设计约束（可回写平面设计）</div>
                  {pack.market.designImplications.map((d) => (
                    <div key={d}>· {d}</div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-white rounded-3xl border border-violet-100 shadow-sm p-5 space-y-3">
              <h3 className="font-black text-slate-900 flex items-center gap-2">
                <Briefcase className="text-violet-600" size={18} /> 产品经理 · 定位与设计要点
              </h3>
              <p className="text-sm text-slate-700 font-medium leading-relaxed">
                {pack.pm.positioning}
              </p>
              <div className="text-xs space-y-2">
                <div>
                  <span className="font-black text-slate-800">买家画像：</span>
                  <span className="text-slate-600 font-medium">
                    {(pack.pm.buyerPersonas || []).join(' · ')}
                  </span>
                </div>
                <div>
                  <span className="font-black text-slate-800">价值主张：</span>
                  <span className="text-slate-600 font-medium">
                    {(pack.pm.valueProps || []).join('；')}
                  </span>
                </div>
                <div className="rounded-xl bg-violet-50 border border-violet-100 px-3 py-2 text-violet-950 font-medium space-y-1">
                  <div className="font-black">设计必须项</div>
                  {(pack.pm.designMustHaves || []).map((d) => (
                    <div key={d}>· {d}</div>
                  ))}
                </div>
                <div>
                  <span className="font-black text-slate-800">Listing 角度：</span>
                  <span className="text-slate-600 font-medium">
                    {(pack.pm.listingAngles || []).join(' · ')}
                  </span>
                </div>
              </div>
            </section>
          </div>

          {pack.batchMailGroup && (
            <MailGroupCard title="批量开发信模板（同市场可复用）" group={pack.batchMailGroup} />
          )}

          <section className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
              <h3 className="font-black text-slate-800 flex items-center gap-2">
                <Search size={16} className="text-emerald-600" />
                匹配客户 {pack.matches.length ? `(${pack.matches.length})` : ''}
              </h3>
              <span className="text-[10px] font-bold text-slate-400">含专业匹配理由 · 前 3 家已写开发信</span>
            </div>
            {!pack.matches.length ? (
              <div className="p-10 text-center text-slate-400 font-bold text-sm">
                暂无足够匹配。可先在客户库补线索，或放宽品类后再跑。
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pack.matches.map((m) => (
                  <li key={`${m.clientId || m.website || m.companyName}`} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-slate-900">{m.companyName}</span>
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                              m.score >= 70
                                ? 'bg-emerald-100 text-emerald-700'
                                : m.score >= 40
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            匹配度 {m.score}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400">
                            {m.source === 'both'
                              ? 'CRM+背调库'
                              : m.source === 'crm'
                                ? 'CRM'
                                : '背调产品库'}
                          </span>
                        </div>
                        <div className="text-xs text-blue-600 font-bold mt-0.5 truncate">
                          {m.website || '—'}
                          {m.country ? ` · ${m.country}` : ''}
                        </div>
                        <ul className="mt-2 space-y-0.5">
                          {m.reasons.map((r) => (
                            <li key={r} className="text-xs text-slate-500 font-medium">
                              · {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex flex-col gap-2">
                        {m.historyId && onOpenHistory && (
                          <button
                            type="button"
                            onClick={() => openHistoryFor(m)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold"
                          >
                            <ExternalLink size={12} /> 打开背调
                          </button>
                        )}
                        {m.mailGroup && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedMail((prev) =>
                                prev === m.companyName ? null : m.companyName
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-200 text-indigo-700 text-xs font-bold"
                          >
                            <Mail size={12} />
                            {expandedMail === m.companyName ? '收起开发信' : '查看开发信组'}
                          </button>
                        )}
                      </div>
                    </div>
                    {expandedMail === m.companyName && m.mailGroup && (
                      <div className="mt-3">
                        <MailGroupCard
                          title={`${m.companyName} · 专属开发信组`}
                          group={m.mailGroup}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};
