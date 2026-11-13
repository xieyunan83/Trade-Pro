import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Newspaper,
  Sparkles,
  LineChart,
  RefreshCw,
  Loader2,
  ExternalLink,
  Radio,
  ArrowRight,
  Target,
  Mail,
  Globe2,
  TrendingUp,
  Landmark,
  BadgeCheck,
  Wallet,
} from 'lucide-react';
import type { User } from '../types';
import { ModuleType } from '../types';
import {
  buildLandingSeed,
  fetchLandingHub,
  loadLandingCache,
  loadLandingCacheAllowStale,
  type LandingPayload,
} from '../services/landingHub';
import { withShowcaseProducts } from '../services/landingShowcase';
import {
  loadCatalogAutoMatchReport,
  type CatalogAutoMatchReport,
} from '../services/catalogAutoMatch';
import type { JourneyProgressHint } from '../services/tradeJourney';
import { useAutomationCounts } from '../services/automationQueueHooks';
import { loadCatalogSkus } from '../services/productCatalogTypes';
import {
  INTEL_NAV_CATEGORIES,
  LANDING_INTEL_NAV,
  type IntelNavCategory,
} from '../services/landingIntelNav';
import { LandingOpsPulse } from './LandingOpsPulse';
import type { HistoryItem } from '../types';

type Props = {
  currentUser: User;
  syncStatus?: string | null;
  syncing?: boolean;
  onEnterWorkspace?: () => void;
  onOpenDataSetup?: () => void;
  onNavigateModule?: (mod: ModuleType) => void;
  /** @deprecated 任务流已迁至「智能任务」菜单，保留仅用于顶栏作业计数 */
  onStartPlaybook?: (playbookId: string) => void;
  journeyProgress?: JourneyProgressHint;
  /** 用于今日操作日志汇总背调/决策人 */
  history?: HistoryItem[];
};

const initialLanding = (): LandingPayload =>
  loadLandingCache() || loadLandingCacheAllowStale() || buildLandingSeed();

const fmtTime = (ms?: number) => {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const CATEGORY_ICON: Record<IntelNavCategory, React.ReactNode> = {
  trend: <TrendingUp size={12} strokeWidth={2.25} />,
  macro: <Landmark size={12} strokeWidth={2.25} />,
  verify: <BadgeCheck size={12} strokeWidth={2.25} />,
  demand: <Wallet size={12} strokeWidth={2.25} />,
};

export const ModuleLandingHub: React.FC<Props> = ({
  currentUser,
  onEnterWorkspace,
  onNavigateModule,
  journeyProgress,
  history = [],
}) => {
  const [data, setData] = useState<LandingPayload>(initialLanding);
  const [loading, setLoading] = useState(() => !loadLandingCache());
  const [err, setErr] = useState<string | null>(null);
  const [matchReport, setMatchReport] = useState<CatalogAutoMatchReport | null>(() =>
    loadCatalogAutoMatchReport()
  );
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(async (force = false) => {
    const cur = dataRef.current;
    const hasPaint =
      (cur.fx?.quotes?.length || 0) > 0 ||
      (cur.news?.items?.length || 0) > 0 ||
      (cur.products?.items?.length || 0) > 0;
    if (!hasPaint || force) setLoading(true);
    setErr(null);
    try {
      const payload = await fetchLandingHub({ force });
      setData(payload);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    setMatchReport(loadCatalogAutoMatchReport());
  }, [data?.fetchedAt, loading]);

  const fx = data?.fx?.quotes || [];
  const news = data?.news?.items || [];
  const products = withShowcaseProducts(data?.products?.items).slice(0, 6);
  const goCatalog = () => onNavigateModule?.(ModuleType.PRODUCT_CATALOG);
  const goMatch = () => onNavigateModule?.(ModuleType.PRODUCT_MATCH);
  const priorityHits = (matchReport?.hits || [])
    .filter((h) => h.channel === 'priority_1to1')
    .slice(0, 5);
  const matchFresh =
    !!matchReport && Date.now() - matchReport.at < 14 * 24 * 3600_000;

  const autoCounts = useAutomationCounts();
  const jp: JourneyProgressHint = {
    skuCount: journeyProgress?.skuCount ?? loadCatalogSkus().length,
    pendingTasks: autoCounts.pending,
    failedTasks: autoCounts.failed,
    completedBg: autoCounts.completedWithAnalysis,
    crmCount: journeyProgress?.crmCount ?? 0,
  };

  return (
    <div className="tp-landing relative w-full max-w-none min-w-0 box-border space-y-3">
      {/* 指挥顶栏 */}
      <section className="tp-hub-hero text-white">
        <div className="relative px-3 sm:px-4 py-2.5 flex flex-nowrap items-center gap-2 sm:gap-3 min-h-[2.85rem]">
          <div className="hidden sm:inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-teal-300/90 shrink-0">
            <Radio size={10} className="tp-live-dot text-teal-400" /> Live Hub
          </div>
          <div className="min-w-0 flex-1 flex items-center gap-2 truncate">
            <span className="text-sm font-bold tracking-tight truncate">
              外贸智慧协同
              <span className="font-medium text-slate-300 text-xs ml-2">{currentUser.username}</span>
            </span>
            <span className="hidden lg:inline text-[10px] text-slate-400/90 font-medium truncate font-mono tabular-nums">
              SKU {jp.skuCount} · QUEUE {jp.pendingTasks} · DONE {jp.completedBg} · CRM {jp.crmCount}
              {data?.fetchedAt ? ` · ${fmtTime(data.fetchedAt)}` : ''}
            </span>
          </div>
          <div className="flex flex-nowrap gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setMatchReport(loadCatalogAutoMatchReport());
                void load(true);
              }}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              刷新
            </button>
            {onEnterWorkspace && (
              <button
                type="button"
                onClick={onEnterWorkspace}
                className="inline-flex items-center gap-1 rounded-lg bg-teal-400 hover:bg-teal-300 text-slate-950 px-3 py-1 text-xs font-bold"
              >
                客户搜索
              </button>
            )}
            {onNavigateModule && (
              <button
                type="button"
                onClick={() => onNavigateModule(ModuleType.PROMO_GENERATOR)}
                className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 px-2.5 py-1 text-xs font-semibold"
              >
                自动化获客
              </button>
            )}
          </div>
        </div>
      </section>

      {err && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-950 px-3 py-2 text-xs font-semibold">
          部分情报暂未刷新，可点「刷新」；或进入客户搜索 / 智能任务。
        </div>
      )}

      <LandingOpsPulse
        currentUser={currentUser}
        history={history}
        onNavigateModule={onNavigateModule}
      />

      {/* 全球市场雷达：深色控制台，四通道列表，非卡片堆叠 */}
      <section className="tp-hub-radar overflow-hidden">
        <header className="relative z-[1] px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-teal-400/15 border border-teal-300/25 text-teal-200 flex items-center justify-center shrink-0">
              <Globe2 size={15} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-tight">全球市场雷达</h2>
                <span className="hidden sm:inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-300/80">
                  <span className="tp-live-dot inline-block h-1.5 w-1.5 rounded-full bg-teal-400" />
                  Signal Open
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium truncate">
                精选权威公开源 · 点击直达 · 本地静态入口不增加加载负担
              </p>
            </div>
          </div>
          <span className="hidden md:inline text-[9px] font-mono text-slate-500 tracking-wider shrink-0">
            INTEL × {LANDING_INTEL_NAV.length}
          </span>
        </header>
        <div className="relative z-[1] grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/8">
          {INTEL_NAV_CATEGORIES.map((cat) => {
            const items = LANDING_INTEL_NAV.filter((i) => i.category === cat.id);
            if (!items.length) return null;
            return (
              <div key={cat.id} className="tp-hub-radar-channel min-w-0 p-3 sm:p-3.5">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/5 border border-white/10 text-teal-200">
                    {CATEGORY_ICON[cat.id]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-bold text-slate-100">{cat.title}</span>
                      <span className="text-[9px] font-mono text-teal-400/70 tracking-wider">
                        {cat.channel}
                      </span>
                    </div>
                    <p className="text-[9px] text-slate-500 font-medium">{cat.sub}</p>
                  </div>
                </div>
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tp-hub-radar-link group flex items-center gap-2 rounded-md px-1.5 py-1.5"
                      >
                        <span className="w-9 shrink-0 text-[9px] font-mono font-bold text-teal-400/80 tracking-wide">
                          {item.code}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-slate-100 truncate group-hover:text-teal-100">
                            {item.label}
                          </span>
                          <span className="block text-[9px] text-slate-500 truncate">{item.blurb}</span>
                        </span>
                        <ExternalLink
                          size={11}
                          className="shrink-0 text-slate-600 group-hover:text-teal-300 transition-colors"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* 作业主区：新闻 | 新品 | 汇率 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
        <section className="tp-surface lg:col-span-3 overflow-hidden flex flex-col min-h-[240px] max-h-[360px] lg:max-h-[340px]">
          <header className="px-3 py-2.5 border-b border-slate-100/90 flex items-center gap-2 shrink-0">
            <div className="h-7 w-7 rounded-lg bg-slate-900 text-teal-300 flex items-center justify-center">
              <Newspaper size={13} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 leading-tight tracking-tight">行业新闻</h2>
              <p className="text-[10px] text-slate-500 font-medium">国内 · 国际 · 优选</p>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
            {loading && !news.length ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold p-4 justify-center">
                <Loader2 className="animate-spin" size={14} /> 拉取中…
              </div>
            ) : news.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-4 text-center">
                <p className="text-xs text-slate-500 font-medium">
                  {data?.news?.error || err || '暂时拉不到资讯'}
                </p>
                <button
                  type="button"
                  onClick={() => void load(true)}
                  className="text-[11px] font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-lg"
                >
                  重新拉取
                </button>
              </div>
            ) : (
              news.slice(0, 8).map((n) => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-2 rounded-lg hover:bg-teal-50/80 px-2 py-1.5 transition-colors"
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                      n.region === 'intl'
                        ? 'bg-sky-500'
                        : n.region === 'industry'
                          ? 'bg-cyan-600'
                          : 'bg-emerald-500'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-800 leading-snug line-clamp-2 group-hover:text-teal-900">
                      {n.title}
                    </p>
                    <p className="text-[10px] font-medium text-slate-400 mt-0.5">{n.source}</p>
                  </div>
                  <ExternalLink size={10} className="shrink-0 text-slate-300 mt-1 group-hover:text-teal-600" />
                </a>
              ))
            )}
          </div>
        </section>

        <section className="tp-surface lg:col-span-6 overflow-hidden flex flex-col min-h-[240px] max-h-[360px] lg:max-h-[340px]">
          <header className="px-3 py-2.5 border-b border-slate-100/90 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-lg bg-slate-900 text-amber-200 flex items-center justify-center shrink-0">
                <Sparkles size={13} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900 leading-tight tracking-tight">新品推荐</h2>
                <p className="text-[10px] text-slate-500 font-medium truncate">
                  优先展示产品库带图 SKU · 点击进产品库
                </p>
              </div>
            </div>
            {onNavigateModule ? (
              <button
                type="button"
                onClick={goCatalog}
                className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200/80 px-2.5 py-1 rounded-lg"
              >
                去产品库 <ArrowRight size={12} />
              </button>
            ) : null}
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2.5">
            {loading && products.length === 0 ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold py-10 justify-center">
                <Loader2 className="animate-spin" size={14} /> 加载中…
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  暂无带图新品。请到产品库为 SKU 点「图」上传后，再回看板点刷新。
                </p>
                {onNavigateModule ? (
                  <button
                    type="button"
                    onClick={goCatalog}
                    className="text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg"
                  >
                    去产品库补图
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={goCatalog}
                    className="group text-left rounded-xl border border-slate-200/90 hover:border-teal-300 hover:shadow-sm bg-white overflow-hidden transition-all"
                  >
                    <div className="relative aspect-[4/3] bg-slate-50 border-b border-slate-100 flex items-center justify-center p-2">
                      <img
                        src={p.image}
                        alt=""
                        className="max-h-full max-w-full w-auto h-auto object-contain"
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-xs font-bold text-slate-800 leading-snug line-clamp-2 group-hover:text-teal-900">
                        {p.title}
                      </p>
                      {p.specs?.[0] ? (
                        <p className="text-[10px] font-medium text-slate-400 mt-0.5 truncate">
                          {p.specs[0].label} {p.specs[0].value}
                        </p>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="tp-surface tp-hub-fx lg:col-span-3 overflow-hidden flex flex-col min-h-[240px] max-h-[360px] lg:max-h-[340px]">
          <header className="px-3 py-2.5 border-b border-slate-100/90 flex items-center gap-2 shrink-0">
            <div className="h-7 w-7 rounded-lg bg-slate-900 text-emerald-300 flex items-center justify-center">
              <LineChart size={13} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 leading-tight">即时汇率</h2>
              <p className="text-[10px] text-slate-500 font-medium">中行买入 / 卖出 / 中间价</p>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {loading && !fx.length ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold p-4 justify-center">
                <Loader2 className="animate-spin" size={14} /> 拉取中…
              </div>
            ) : fx.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-3 text-center">
                <p className="text-xs text-slate-500 font-medium">
                  {data?.fx?.error || '暂无汇率数据'}
                </p>
                <button
                  type="button"
                  onClick={() => void load(true)}
                  className="text-[11px] font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-lg"
                >
                  重新拉取
                </button>
              </div>
            ) : (
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-slate-50/95 text-slate-500 font-bold backdrop-blur-sm">
                  <tr>
                    <th className="px-2.5 py-2 font-semibold">货币</th>
                    <th className="px-1.5 py-2 text-right font-semibold">买入</th>
                    <th className="px-1.5 py-2 text-right font-semibold">卖出</th>
                    <th className="px-2.5 py-2 text-right font-semibold">中间</th>
                  </tr>
                </thead>
                <tbody>
                  {fx.map((q) => (
                    <tr
                      key={q.code || q.currency}
                      className="border-t border-slate-50 hover:bg-emerald-50/50 transition-colors"
                    >
                      <td className="px-2.5 py-2">
                        <div className="font-bold text-slate-800">{q.currency}</div>
                        <div className="text-[9px] font-mono font-semibold text-slate-400">{q.code}</div>
                      </td>
                      <td className="px-1.5 py-2 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                        {q.bocBuy}
                      </td>
                      <td className="px-1.5 py-2 text-right font-mono font-semibold text-rose-700 tabular-nums">
                        {q.bocSell}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono font-bold text-slate-900 tabular-nums">
                        {q.bocMid}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <footer className="px-2.5 py-1.5 border-t border-slate-100 text-[9px] text-slate-400 font-medium shrink-0 font-mono">
            BOC · /100 FX
            {fx[0]?.publishedAt ? ` · ${fx[0].publishedAt}` : ''}
          </footer>
        </section>
      </div>

      {/* 优选匹配客户 */}
      <section className="tp-surface overflow-hidden">
        <header className="px-3 py-2.5 border-b border-slate-100/90 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-slate-900 text-teal-200 flex items-center justify-center shrink-0">
              <Target size={13} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 leading-tight tracking-tight">
                优选匹配客户
              </h2>
              <p className="text-[10px] text-slate-500 font-medium truncate">
                产品库挂好一级与二级类目后自动匹配已背调客户 · 重点一对一 / 邮件测品
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 shrink-0">
            {onNavigateModule ? (
              <>
                <button
                  type="button"
                  onClick={goCatalog}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg"
                >
                  产品库
                </button>
                <button
                  type="button"
                  onClick={goMatch}
                  className="inline-flex items-center gap-1 text-xs font-bold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200/80 px-2.5 py-1 rounded-lg"
                >
                  产品匹配 <ArrowRight size={12} />
                </button>
              </>
            ) : null}
          </div>
        </header>
        <div className="p-3">
          {!matchFresh || !matchReport ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3">
              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                尚无入库匹配结果。请到产品库为 SKU 选择官方一级与二级小类后导入/保存，系统会自动匹配并在此展示重点客户。
              </p>
              {onNavigateModule ? (
                <button
                  type="button"
                  onClick={goCatalog}
                  className="shrink-0 text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg"
                >
                  去挂类目
                </button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
                <span className="rounded-md bg-emerald-100 text-emerald-800 px-2.5 py-0.5">
                  重点一对一 {matchReport.priorityCount}
                </span>
                <span className="rounded-md bg-amber-100 text-amber-900 px-2.5 py-0.5 inline-flex items-center gap-1">
                  <Mail size={10} /> EDM 测品 {matchReport.edmCount}
                </span>
                <span className="rounded-md bg-slate-100 text-slate-600 px-2.5 py-0.5">
                  扫 SKU {matchReport.skuCount} · 命中 {matchReport.matchCount}
                </span>
                <span className="text-slate-400 font-medium ml-auto">{fmtTime(matchReport.at)}</span>
              </div>
              {priorityHits.length === 0 ? (
                <p className="text-xs text-slate-500 font-medium">
                  暂无「重点一对一」客户，可到产品匹配查看 EDM 测品名单或补跑匹配。
                </p>
              ) : (
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {priorityHits.map((h) => (
                    <li
                      key={`${h.clientId || h.website || h.companyName}`}
                      className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-2.5 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{h.companyName}</p>
                          <p className="text-[10px] font-medium text-slate-500 truncate mt-0.5">
                            {h.country || '—'}
                            {h.website ? ` · ${h.website}` : ''}
                          </p>
                        </div>
                        <span className="shrink-0 text-[10px] font-bold text-emerald-800 bg-white border border-emerald-200 rounded-md px-1.5 py-0.5">
                          {h.score}分
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-600 font-medium mt-1 line-clamp-2 leading-snug">
                        {h.outreachAdvice || h.gradeReasons?.[0] || h.reasons[0] || '建议一对一精准开发'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
