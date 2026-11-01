import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalysisResult, Client, HistoryItem, MailGroup, User } from '../types';
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
import {
  buildProductProfileFromAnalysis,
  loadProductCatalog,
  matchCatalogSkusToClientProfile,
  type CatalogSkuClientHit,
  productCatalogDomainKey,
} from '../services/productCatalog';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import { CreativePipelineBar } from './CreativeRefPicker';
import { CatalogCoveragePanel } from './CatalogCoveragePanel';
import { DesignConstraintCardPanel } from './DesignConstraintCardPanel';
import { MatchInputForm, type MatchFormValues } from './MatchInputForm';
import {
  Search,
  Loader2,
  Sparkles,
  Globe2,
  Briefcase,
  Mail,
  Copy,
  CheckCircle2,
  ExternalLink,
  Compass,
  BadgeDollarSign,
  ArrowLeft,
  Package,
  Target,
} from 'lucide-react';

interface ModuleProductMatchProps {
  history: HistoryItem[];
  crmClients: Client[];
  currentUser?: User;
  /** 当前打开的背调报告：有则进入「对该客户匹配我方产品」模式 */
  focusAnalysis?: AnalysisResult | null;
  onCrmClientsChange?: (clients: Client[]) => void;
  onStartDesignFill?: (blankClients: Client[]) => void;
  onOpenHistory?: (item: HistoryItem) => void;
  onGoCrm?: () => void;
  onNavigateModule?: (mod: ModuleType) => void;
  /** 返回当前客户背调 */
  onBackToReport?: () => void;
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
  currentUser,
  focusAnalysis = null,
  onCrmClientsChange,
  onStartDesignFill,
  onOpenHistory,
  onGoCrm,
  onNavigateModule,
  onBackToReport,
}) => {
  const focusCompany = (focusAnalysis?.companyInfo?.name || '').trim();
  const focusWebsite = (focusAnalysis?.companyInfo?.website || '').trim();
  const clientMode = !!(focusCompany || focusWebsite);

  const suggested = useMemo(() => suggestGtmInputFromCreative(), []);
  const formInitial = useMemo<MatchFormValues>(
    () => ({
      productName: suggested.productName || '',
      category: suggested.category || '',
      priceBand: suggested.priceBand || '',
      skuCode: suggested.skuCode || '',
      notes: suggested.notes || suggested.designNotes || '',
    }),
    [suggested]
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pack, setPack] = useState<GtmLaunchPack | null>(() => loadGtmLaunchPacks()[0] || null);
  const [expandedMail, setExpandedMail] = useState<string | null>(null);
  const [clientHits, setClientHits] = useState<CatalogSkuClientHit[]>([]);
  const [clientBusy, setClientBusy] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientMeta, setClientMeta] = useState<{ quality: number; skuCount: number } | null>(
    null
  );
  /** 背调上下文中也可切到「新品找客户」全库模式 */
  const [forceLaunchMode, setForceLaunchMode] = useState(false);
  const showClientMatch = clientMode && !forceLaunchMode;

  const openHistoryFor = (m: GtmClientMatch) => {
    if (!m.historyId || !onOpenHistory) return;
    const item = history.find((h) => h.id === m.historyId);
    if (item) onOpenHistory(item);
  };

  const runClientMatch = useCallback(async () => {
    if (!focusAnalysis) return;
    setClientBusy(true);
    setClientError(null);
    try {
      const built = buildProductProfileFromAnalysis(focusAnalysis);
      const domain = productCatalogDomainKey(focusWebsite);
      const stored = await loadProductCatalog();
      const fromStore =
        stored.find(
          (p) =>
            (domain && productCatalogDomainKey(p.website) === domain) ||
            (focusCompany &&
              (p.companyName || '').toLowerCase() === focusCompany.toLowerCase())
        ) || null;
      const profile =
        fromStore && (fromStore.catalogQuality || 0) >= (built?.catalogQuality || 0)
          ? fromStore
          : built || fromStore;
      if (!profile) {
        setClientHits([]);
        setClientMeta(null);
        setClientError('当前客户尚无可用产品画像，请先完成背调或产品深挖。');
        return;
      }
      const ourSkus = loadCatalogSkus();
      setClientMeta({
        quality: profile.catalogQuality || 0,
        skuCount: ourSkus.length,
      });
      if (!ourSkus.length) {
        setClientHits([]);
        setClientError('产品库暂无 SKU。请先在「产品库」导入或录入，再回来匹配。');
        return;
      }
      const hits = matchCatalogSkusToClientProfile(ourSkus, profile, {
        limit: 40,
        minScore: 22,
      });
      setClientHits(hits);
      if (!hits.length) {
        setClientError(
          '暂无足够匹配的我方产品。可补充产品库品类，或对该客户做产品深挖后再试。'
        );
      }
    } catch (e: unknown) {
      setClientError(e instanceof Error ? e.message : '匹配失败，请稍后重试');
      setClientHits([]);
    } finally {
      setClientBusy(false);
    }
  }, [focusAnalysis, focusCompany, focusWebsite]);

  useEffect(() => {
    if (!showClientMatch) return;
    void runClientMatch();
  }, [showClientMatch, focusCompany, focusWebsite, runClientMatch]);

  const run = useCallback(
    async (values: MatchFormValues) => {
      setBusy(true);
      setError(null);
      setProgress('启动双专家…');
      try {
        const next = await runGtmLaunchPack({
          input: {
            productName: values.productName,
            category: values.category || undefined,
            priceBand: values.priceBand || undefined,
            skuCode: values.skuCode || undefined,
            notes: values.notes || undefined,
            designNotes: values.notes || undefined,
          },
          crmClients,
          history,
          mailTopN: 2,
          skipBatchMail: true,
          onProgress: (_pct, label) => setProgress(label),
          onPartial: (partial) => {
            // 匹配结果先上屏，开发信后台并行补写
            setPack({ ...partial });
            setExpandedMail(null);
            setProgress(`已匹配 ${partial.matches.length} 家，正在补写开发信…`);
          },
        });
        setPack(next);
        setExpandedMail(next.matches.find((m) => m.mailGroup)?.companyName || null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '编排失败，请稍后重试');
      } finally {
        setBusy(false);
        setProgress('');
      }
    },
    [crmClients, history]
  );

  if (showClientMatch) {
    return (
      <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {onBackToReport && (
              <button
                type="button"
                onClick={onBackToReport}
                className="inline-flex items-center gap-1.5 text-[11px] font-black text-slate-600 hover:text-slate-900"
              >
                <ArrowLeft size={14} /> 返回背调
              </button>
            )}
            {onNavigateModule && (
              <button
                type="button"
                onClick={() => onNavigateModule(ModuleType.PRODUCTS)}
                className="text-[11px] font-bold text-cyan-700 hover:underline"
              >
                查看该客户产品分析
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setForceLaunchMode(true)}
            className="text-[11px] font-bold text-slate-400 hover:text-slate-700"
          >
            切换：新品找客户
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-slate-900 font-black text-base sm:text-lg">
              <Target className="text-emerald-600" size={18} />
              对本客户匹配我方产品
            </div>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5 truncate max-w-xl">
              {focusCompany || focusWebsite}
              {focusWebsite ? ` · ${focusWebsite}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {clientMeta && (
              <>
                <span className="rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100 px-2 py-0.5 text-[10px] font-black">
                  画像 {clientMeta.quality}
                </span>
                <span className="rounded-full bg-cyan-50 text-cyan-800 border border-cyan-100 px-2 py-0.5 text-[10px] font-black">
                  命中 {clientHits.length}/{clientMeta.skuCount}
                </span>
              </>
            )}
            <button
              type="button"
              disabled={clientBusy}
              onClick={() => void runClientMatch()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3 py-2 text-xs font-black"
            >
              {clientBusy ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
              {clientBusy ? '匹配中…' : '重新匹配'}
            </button>
          </div>
          {clientError && (
            <div className="w-full rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              {clientError}
            </div>
          )}
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-1.5">
              <Package size={14} className="text-emerald-600" />
              推荐我方产品 {clientHits.length ? `(${clientHits.length})` : ''}
            </h3>
            <span className="text-[10px] font-bold text-slate-400">卡片可扫一眼看匹配理由</span>
          </div>
          {clientBusy && !clientHits.length ? (
            <div className="p-8 flex items-center justify-center gap-2 text-slate-400 text-sm font-bold bg-white rounded-2xl border border-slate-100">
              <Loader2 className="animate-spin text-emerald-600" size={18} /> 正在对照客户画像…
            </div>
          ) : !clientHits.length ? (
            <div className="p-8 text-center text-slate-400 font-bold text-sm bg-white rounded-2xl border border-slate-100">
              暂无命中。可先完善产品库，或返回背调补充品类后再匹配。
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {clientHits.map((h) => (
                <article
                  key={h.sku.id}
                  className="rounded-2xl border border-emerald-100/80 bg-gradient-to-br from-white via-emerald-50/30 to-cyan-50/40 shadow-sm overflow-hidden flex flex-col"
                >
                  <div className="relative aspect-[4/3] bg-slate-50">
                    {h.sku.images?.[0] ? (
                      <img
                        src={h.sku.images[0]}
                        alt=""
                        className="absolute inset-0 w-full h-full object-contain p-3"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-emerald-200">
                        <Package size={36} />
                      </div>
                    )}
                    <span
                      className={`absolute top-2 right-2 text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm ${
                        h.score >= 70
                          ? 'bg-emerald-500 text-white'
                          : h.score >= 40
                            ? 'bg-amber-400 text-amber-950'
                            : 'bg-white/90 text-slate-600'
                      }`}
                    >
                      {h.score}分
                    </span>
                  </div>
                  <div className="p-3 space-y-1.5 flex-1 flex flex-col">
                    <div className="font-black text-slate-900 text-sm leading-snug line-clamp-2">
                      {h.sku.name}
                    </div>
                    <div className="text-[10px] font-bold text-slate-400">
                      {h.sku.skuCode ? `#${h.sku.skuCode} · ` : ''}
                      {h.sku.category || '未分类'}
                      {h.sku.factoryPrice != null
                        ? ` · ${h.sku.currency || 'CNY'} ${h.sku.factoryPrice}`
                        : ''}
                      {h.priceOverlap ? ' · 价带重叠' : ''}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1 mt-auto">
                      {h.reasons.slice(0, 4).map((r) => (
                        <span
                          key={r}
                          className="text-[9px] font-bold text-emerald-800/80 bg-white/80 border border-emerald-100 rounded-lg px-1.5 py-0.5 max-w-full truncate"
                          title={r}
                        >
                          {r.replace(/^[^：:]*[：:]/, '').slice(0, 18) || r.slice(0, 18)}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {onNavigateModule && (
          <div className="flex flex-wrap gap-3 text-[11px] font-bold">
            <button
              type="button"
              onClick={() => onNavigateModule(ModuleType.PRODUCT_CATALOG)}
              className="text-violet-700 hover:underline"
            >
              去产品库补充 SKU
            </button>
            {onBackToReport && (
              <button type="button" onClick={onBackToReport} className="text-slate-500 hover:underline">
                返回该客户背调报告
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CreativePipelineBar current="match" onNavigate={onNavigateModule} />
        <div className="flex flex-wrap items-center gap-3">
          {clientMode && forceLaunchMode && (
            <button
              type="button"
              onClick={() => setForceLaunchMode(false)}
              className="text-[11px] font-bold text-emerald-700 hover:underline"
            >
              回到「{focusCompany || '当前客户'}」匹配
            </button>
          )}
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
      </div>

      <MatchInputForm
        initial={formInitial}
        busy={busy}
        progress={progress}
        error={error}
        crmCount={crmClients.length}
        historyCount={history.length}
        onGoCrm={onGoCrm}
        onSubmit={(values) => void run(values)}
      />

      <CatalogCoveragePanel
        history={history}
        crmClients={crmClients}
        ownerUsername={currentUser?.username}
        departmentId={currentUser?.departmentId}
        onCrmPatched={onCrmClientsChange}
        onStartDesignFill={onStartDesignFill}
        defaultCollapsed
      />

      {pack && (
        <>
          {(pack.pricingAdvice || pack.designCard) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {pack.pricingAdvice && (
                <section className="bg-white rounded-3xl border border-teal-100 shadow-sm p-5 space-y-3">
                  <h3 className="font-black text-slate-900 flex items-center gap-2">
                    <BadgeDollarSign className="text-teal-600" size={18} /> 定价参考
                    <span className="text-[10px] font-black text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-100">
                      置信{pack.pricingAdvice.confidence} {pack.pricingAdvice.confidenceScore}
                    </span>
                  </h3>
                  <div className="text-sm font-black text-teal-800">{pack.pricingAdvice.verdict}</div>
                  <div className="text-[10px] font-bold text-slate-500">
                    证据层级：{pack.pricingAdvice.evidenceTier || '—'}
                    {pack.pricingAdvice.formulaUsed
                      ? ` · ${pack.pricingAdvice.formulaUsed.slice(0, 80)}`
                      : ''}
                  </div>
                  {pack.pricingAdvice.suggestedFactory && (
                    <div className="text-xs font-bold text-slate-700">
                      建议出厂 ¥{pack.pricingAdvice.suggestedFactory.min}–
                      {pack.pricingAdvice.suggestedFactory.max}
                      {pack.pricingAdvice.ourFactoryCny != null
                        ? ` · 我方约 ¥${Math.round(pack.pricingAdvice.ourFactoryCny)}`
                        : ''}
                    </div>
                  )}
                  <ul className="space-y-1">
                    {pack.pricingAdvice.reasons.map((r) => (
                      <li key={r} className="text-[11px] font-medium text-slate-600 leading-relaxed">
                        · {r}
                      </li>
                    ))}
                  </ul>
                  {pack.pricingAdvice.assumptions.slice(0, 2).map((a) => (
                    <p key={a} className="text-[10px] font-bold text-slate-400 leading-relaxed">
                      {a}
                    </p>
                  ))}
                </section>
              )}
              {pack.designCard && (
                <DesignConstraintCardPanel
                  categoryOrName={pack.category || pack.productName}
                  targetMarket={pack.market.countries[0]?.name}
                  priceBandText={pack.priceBand}
                  skuCode={pack.skuCode}
                />
              )}
            </div>
          )}

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
