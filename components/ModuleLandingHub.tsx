import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Newspaper,
  Sparkles,
  LineChart,
  RefreshCw,
  Loader2,
  ExternalLink,
  Radio,
  ArrowRight,
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
import { TradeJourneyPanel } from './TradeJourneyPanel';
import type { JourneyProgressHint } from '../services/tradeJourney';

type Props = {
  currentUser: User;
  /** @deprecated 前台不再展示同步条数 */
  syncStatus?: string | null;
  syncing?: boolean;
  onEnterWorkspace?: () => void;
  onOpenDataSetup?: () => void;
  onNavigateModule?: (mod: ModuleType) => void;
  onStartPlaybook?: (playbookId: string) => void;
  journeyProgress?: JourneyProgressHint;
};

const SHOWCASE_ACCENTS = [
  'from-cyan-100 to-sky-50',
  'from-amber-100 to-orange-50',
  'from-emerald-100 to-teal-50',
  'from-sky-100 to-cyan-50',
  'from-rose-100 to-orange-50',
];

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

export const ModuleLandingHub: React.FC<Props> = ({
  currentUser,
  onEnterWorkspace,
  onNavigateModule,
  onStartPlaybook,
  journeyProgress,
}) => {
  const [data, setData] = useState<LandingPayload>(initialLanding);
  const [loading, setLoading] = useState(() => !loadLandingCache());
  const [err, setErr] = useState<string | null>(null);
  const [featuredIdx, setFeaturedIdx] = useState(0);
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
    const imgs = withShowcaseProducts(dataRef.current.products?.items)
      .slice(0, 3)
      .map((p) => p.image)
      .filter(Boolean) as string[];
    const links: HTMLLinkElement[] = [];
    for (const src of imgs) {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = src;
      document.head.appendChild(link);
      links.push(link);
    }
    return () => {
      for (const link of links) link.remove();
    };
  }, [load]);

  const fx = data?.fx?.quotes || [];
  const news = data?.news?.items || [];
  const products = withShowcaseProducts(data?.products?.items);
  const safeFeatured = products.length
    ? Math.min(featuredIdx, products.length - 1)
    : 0;
  const featured = products[safeFeatured];
  const sideProducts = useMemo(() => {
    if (!products.length) return [];
    return products.filter((_, i) => i !== safeFeatured).slice(0, 4);
  }, [products, safeFeatured]);

  // 自动轮播主推款，增加动感
  useEffect(() => {
    if (products.length < 2) return;
    const t = window.setInterval(() => {
      setFeaturedIdx((i) => (i + 1) % Math.min(products.length, 6));
    }, 4500);
    return () => window.clearInterval(t);
  }, [products.length]);

  const goCatalog = () => onNavigateModule?.(ModuleType.PRODUCT_CATALOG);

  return (
    <div className="tp-landing relative -mx-1 sm:mx-0 space-y-3">
      {/* 顶栏 */}
      <section className="relative rounded-2xl border border-cyan-200/60 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950 text-white overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_right,rgba(34,211,238,0.15),transparent_55%)] pointer-events-none" />
        <div className="relative px-3 sm:px-4 py-2.5 flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300/90">
            <Radio size={11} className="animate-pulse" /> Hub
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm sm:text-base font-black tracking-tight truncate">
              外贸智慧协同
              <span className="font-bold text-slate-300 text-xs sm:text-sm ml-2">
                你好，{currentUser.username}
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium truncate">
              选品适市 → 获客背调 → 开发成交
              {data?.fetchedAt ? ` · 情报 ${fmtTime(data.fetchedAt)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 px-2.5 py-1.5 text-[11px] font-extrabold disabled:opacity-50"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              刷新
            </button>
            {onEnterWorkspace && (
              <button
                type="button"
                onClick={onEnterWorkspace}
                className="inline-flex items-center gap-1 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 px-2.5 py-1.5 text-[11px] font-extrabold"
              >
                客户搜索
              </button>
            )}
            {onNavigateModule && (
              <button
                type="button"
                onClick={() => onNavigateModule(ModuleType.PROMO_GENERATOR)}
                className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 px-2.5 py-1.5 text-[11px] font-extrabold"
              >
                自动化获客
              </button>
            )}
          </div>
        </div>
      </section>

      {err && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-950 px-3 py-2 text-xs font-bold">
          部分情报暂未刷新，可点「刷新」；或直接进入客户搜索 / 任务流。
        </div>
      )}

      {/* 新品推荐：主视觉区 */}
      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <header className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-cyan-50/40">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-slate-900 text-amber-300 flex items-center justify-center shadow-sm">
              <Sparkles size={16} />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 tracking-tight">新品推荐</h2>
              <p className="text-[11px] text-slate-500 font-medium">澄海玩具优选 · 大图速览 · 参数一目了然</p>
            </div>
          </div>
          {onNavigateModule ? (
            <button
              type="button"
              onClick={goCatalog}
              className="inline-flex items-center gap-1 text-[11px] font-black text-cyan-800 hover:text-cyan-950 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200/80 px-3 py-1.5 rounded-lg transition-colors"
            >
              去产品库选品 <ArrowRight size={12} />
            </button>
          ) : null}
        </header>

        <div className="p-3 sm:p-4">
          {loading && products.length === 0 ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm font-bold py-16 justify-center">
              <Loader2 className="animate-spin" size={18} /> 加载优选产品…
            </div>
          ) : !featured ? (
            <p className="text-sm text-slate-500 font-medium py-12 text-center">暂无推荐，请稍后刷新</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              {/* 主推大图 */}
              <button
                type="button"
                onClick={goCatalog}
                className="lg:col-span-7 group relative rounded-2xl overflow-hidden bg-slate-900 text-left min-h-[220px] sm:min-h-[280px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {featured.image ? (
                  <img
                    src={featured.image}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    loading="eager"
                    decoding="async"
                  />
                ) : (
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${SHOWCASE_ACCENTS[0]}`}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/35 to-transparent" />
                <div className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-cyan-400 text-slate-950 text-[10px] font-black px-2.5 py-1 shadow">
                  <Sparkles size={11} /> 主推
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5">
                  <h3 className="text-lg sm:text-xl font-black text-white leading-snug line-clamp-2 drop-shadow">
                    {featured.title}
                  </h3>
                  {featured.specs && featured.specs.length > 0 ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {featured.specs.slice(0, 3).map((s) => (
                        <span
                          key={`${featured.id}-${s.label}`}
                          className="rounded-md bg-white/15 backdrop-blur-sm border border-white/20 text-cyan-50 text-[10px] font-bold px-2 py-1"
                        >
                          {s.label} {s.value}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-3 text-[11px] font-bold text-cyan-200/90 inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    加入产品库选品 <ArrowRight size={12} />
                  </p>
                </div>
              </button>

              {/* 侧栏缩略图 */}
              <div className="lg:col-span-5 grid grid-cols-2 gap-2.5 content-start">
                {sideProducts.map((p, idx) => {
                  const realIdx = products.findIndex((x) => x.id === p.id);
                  const active = realIdx === safeFeatured;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setFeaturedIdx(realIdx >= 0 ? realIdx : idx)}
                      onDoubleClick={goCatalog}
                      className={`group text-left rounded-xl overflow-hidden border bg-white transition-all ${
                        active
                          ? 'border-cyan-400 shadow-md ring-1 ring-cyan-200'
                          : 'border-slate-200 hover:border-cyan-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="relative aspect-[4/3] bg-slate-100 overflow-hidden">
                        {p.image ? (
                          <img
                            src={p.image}
                            alt=""
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            loading={idx < 2 ? 'eager' : 'lazy'}
                            decoding="async"
                          />
                        ) : (
                          <div
                            className={`w-full h-full bg-gradient-to-br ${SHOWCASE_ACCENTS[(idx + 1) % SHOWCASE_ACCENTS.length]} flex items-center justify-center text-slate-400`}
                          >
                            <Sparkles size={20} />
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-[11px] font-black text-slate-800 leading-snug line-clamp-2">
                          {p.title}
                        </p>
                        {p.specs?.[0] ? (
                          <p className="text-[9px] font-bold text-cyan-800/80 mt-1 truncate">
                            {p.specs[0].label} {p.specs[0].value}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {products.length > 1 ? (
            <div className="mt-3 flex items-center justify-center gap-1.5">
              {products.slice(0, 6).map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  aria-label={`切换推荐 ${i + 1}`}
                  onClick={() => setFeaturedIdx(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === safeFeatured ? 'w-6 bg-cyan-500' : 'w-1.5 bg-slate-300 hover:bg-slate-400'
                  }`}
                />
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* 新闻 + 汇率：次级情报带 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <section className="lg:col-span-7 rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden flex flex-col max-h-[280px]">
          <header className="px-3 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-slate-900 text-cyan-300 flex items-center justify-center">
              <Newspaper size={14} />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900">行业新闻</h2>
              <p className="text-[10px] text-slate-500 font-medium">国内 · 国际 · 优选</p>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
            {loading && !news.length ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs font-bold p-4 justify-center">
                <Loader2 className="animate-spin" size={14} /> 拉取中…
              </div>
            ) : news.length === 0 ? (
              <p className="text-xs text-slate-500 font-medium p-4 text-center">资讯更新中，请刷新</p>
            ) : (
              news.slice(0, 10).map((n) => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-2 rounded-xl hover:bg-cyan-50/70 px-2.5 py-2 transition-colors"
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                      n.region === 'intl'
                        ? 'bg-sky-500'
                        : n.region === 'industry'
                          ? 'bg-violet-500'
                          : 'bg-emerald-500'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 leading-snug line-clamp-2 group-hover:text-cyan-900">
                      {n.title}
                    </p>
                    <p className="text-[9px] font-bold text-slate-400 mt-0.5">{n.source}</p>
                  </div>
                  <ExternalLink
                    size={11}
                    className="shrink-0 text-slate-300 mt-1 group-hover:text-cyan-600"
                  />
                </a>
              ))
            )}
          </div>
        </section>

        <section className="lg:col-span-5 rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden flex flex-col max-h-[280px]">
          <header className="px-3 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-slate-900 text-emerald-300 flex items-center justify-center">
              <LineChart size={14} />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900">即时汇率</h2>
              <p className="text-[10px] text-slate-500 font-medium">中行买入 / 卖出 / 中间价</p>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {loading && !fx.length ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs font-bold p-4 justify-center">
                <Loader2 className="animate-spin" size={14} /> 拉取中行牌价…
              </div>
            ) : fx.length === 0 ? (
              <p className="text-xs text-slate-500 font-medium p-3 text-center">
                {data?.fx?.error || '暂无汇率数据'}
              </p>
            ) : (
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-slate-50 text-slate-500 font-black">
                  <tr>
                    <th className="px-3 py-2">货币</th>
                    <th className="px-2 py-2 text-right">买入</th>
                    <th className="px-2 py-2 text-right">卖出</th>
                    <th className="px-3 py-2 text-right">中间价</th>
                  </tr>
                </thead>
                <tbody>
                  {fx.map((q) => (
                    <tr key={q.code || q.currency} className="border-t border-slate-50 hover:bg-emerald-50/40">
                      <td className="px-3 py-2">
                        <div className="font-black text-slate-800">{q.currency}</div>
                        <div className="text-[9px] font-bold text-slate-400">{q.code}</div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-bold text-emerald-700 tabular-nums">
                        {q.bocBuy}
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-bold text-rose-700 tabular-nums">
                        {q.bocSell}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-black text-slate-900 tabular-nums">
                        {q.bocMid}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <footer className="px-3 py-1.5 border-t border-slate-100 text-[9px] text-slate-400 font-medium">
            中国银行牌价 · 人民币 / 100 外币
            {fx[0]?.publishedAt ? ` · ${fx[0].publishedAt}` : ''}
          </footer>
        </section>
      </div>

      {onNavigateModule ? (
        <TradeJourneyPanel
          progressHint={
            journeyProgress || {
              skuCount: 0,
              pendingTasks: 0,
              failedTasks: 0,
              completedBg: 0,
              crmCount: 0,
            }
          }
          onNavigate={onNavigateModule}
          onStartPlaybook={onStartPlaybook}
        />
      ) : null}
    </div>
  );
};
