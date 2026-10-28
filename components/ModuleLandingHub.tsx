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
  syncStatus?: string | null;
  syncing?: boolean;
  onEnterWorkspace?: () => void;
  onOpenDataSetup?: () => void;
  onNavigateModule?: (mod: ModuleType) => void;
  onStartPlaybook?: (playbookId: string) => void;
  journeyProgress?: JourneyProgressHint;
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

  const fx = data?.fx?.quotes || [];
  const news = data?.news?.items || [];
  const products = withShowcaseProducts(data?.products?.items).slice(0, 6);
  const goCatalog = () => onNavigateModule?.(ModuleType.PRODUCT_CATALOG);

  return (
    <div className="tp-landing relative -mx-1 sm:mx-0 space-y-2.5">
      {/* 顶栏 */}
      <section className="relative rounded-2xl border border-cyan-200/60 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950 text-white overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_right,rgba(34,211,238,0.15),transparent_55%)] pointer-events-none" />
        <div className="relative px-3 sm:px-4 py-2 flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300/90">
            <Radio size={11} className="animate-pulse" /> Hub
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black tracking-tight truncate">
              外贸智慧协同
              <span className="font-bold text-slate-300 text-xs ml-2">你好，{currentUser.username}</span>
            </div>
            <p className="text-[10px] text-slate-400 font-medium truncate">
              赋能澄海玩具产业升级 · 选品适市 → 获客背调 → 开发成交
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

      {/* 首屏三联：新闻 | 新品 | 汇率 —— 同屏可见 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-stretch">
        {/* 行业新闻 */}
        <section className="lg:col-span-3 rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden flex flex-col min-h-[220px] max-h-[320px] lg:max-h-[300px]">
          <header className="px-3 py-2 border-b border-slate-100 flex items-center gap-2 shrink-0">
            <div className="h-7 w-7 rounded-lg bg-slate-900 text-cyan-300 flex items-center justify-center">
              <Newspaper size={13} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[13px] font-black text-slate-900 leading-tight">行业新闻</h2>
              <p className="text-[9px] text-slate-500 font-medium">国内 · 国际 · 优选</p>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
            {loading && !news.length ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs font-bold p-4 justify-center">
                <Loader2 className="animate-spin" size={14} /> 拉取中…
              </div>
            ) : news.length === 0 ? (
              <p className="text-xs text-slate-500 font-medium p-4 text-center">资讯更新中</p>
            ) : (
              news.slice(0, 8).map((n) => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-2 rounded-lg hover:bg-cyan-50/80 px-2 py-1.5 transition-colors"
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
                    <p className="text-[11px] font-bold text-slate-800 leading-snug line-clamp-2 group-hover:text-cyan-900">
                      {n.title}
                    </p>
                    <p className="text-[9px] font-bold text-slate-400 mt-0.5">{n.source}</p>
                  </div>
                  <ExternalLink size={10} className="shrink-0 text-slate-300 mt-1 group-hover:text-cyan-600" />
                </a>
              ))
            )}
          </div>
        </section>

        {/* 新品推荐：白底 contain，避免大图拉伸发糊 */}
        <section className="lg:col-span-6 rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden flex flex-col min-h-[220px] max-h-[320px] lg:max-h-[300px]">
          <header className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0 bg-gradient-to-r from-slate-50 to-cyan-50/50">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-lg bg-slate-900 text-amber-300 flex items-center justify-center shrink-0">
                <Sparkles size={13} />
              </div>
              <div className="min-w-0">
                <h2 className="text-[13px] font-black text-slate-900 leading-tight">新品推荐</h2>
                <p className="text-[9px] text-slate-500 font-medium truncate">澄海优选 · 清晰主图 · 点击进产品库</p>
              </div>
            </div>
            {onNavigateModule ? (
              <button
                type="button"
                onClick={goCatalog}
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-black text-cyan-800 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200/80 px-2.5 py-1 rounded-lg"
              >
                去产品库 <ArrowRight size={11} />
              </button>
            ) : null}
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            {loading && products.length === 0 ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs font-bold py-10 justify-center">
                <Loader2 className="animate-spin" size={14} /> 加载中…
              </div>
            ) : products.length === 0 ? (
              <p className="text-xs text-slate-500 font-medium py-8 text-center">暂无推荐</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={goCatalog}
                    className="group text-left rounded-xl border border-slate-200 hover:border-cyan-300 hover:shadow-sm bg-white overflow-hidden transition-all"
                  >
                    <div className="relative aspect-square bg-white border-b border-slate-100 flex items-center justify-center p-1.5">
                      {p.image ? (
                        <img
                          src={p.image}
                          alt=""
                          className="max-h-full max-w-full w-auto h-auto object-contain"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <Sparkles size={18} className="text-slate-300" />
                      )}
                    </div>
                    <div className="px-1.5 py-1.5">
                      <p className="text-[10px] font-black text-slate-800 leading-snug line-clamp-2 group-hover:text-cyan-900">
                        {p.title}
                      </p>
                      {p.specs?.[0] ? (
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5 truncate">
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

        {/* 即时汇率 */}
        <section className="lg:col-span-3 rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden flex flex-col min-h-[220px] max-h-[320px] lg:max-h-[300px]">
          <header className="px-3 py-2 border-b border-slate-100 flex items-center gap-2 shrink-0">
            <div className="h-7 w-7 rounded-lg bg-slate-900 text-emerald-300 flex items-center justify-center">
              <LineChart size={13} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[13px] font-black text-slate-900 leading-tight">即时汇率</h2>
              <p className="text-[9px] text-slate-500 font-medium">中行买入 / 卖出 / 中间价</p>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {loading && !fx.length ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs font-bold p-4 justify-center">
                <Loader2 className="animate-spin" size={14} /> 拉取中…
              </div>
            ) : fx.length === 0 ? (
              <p className="text-xs text-slate-500 font-medium p-3 text-center">
                {data?.fx?.error || '暂无汇率数据'}
              </p>
            ) : (
              <table className="w-full text-left text-[10px]">
                <thead className="sticky top-0 bg-slate-50 text-slate-500 font-black">
                  <tr>
                    <th className="px-2.5 py-1.5">货币</th>
                    <th className="px-1.5 py-1.5 text-right">买入</th>
                    <th className="px-1.5 py-1.5 text-right">卖出</th>
                    <th className="px-2.5 py-1.5 text-right">中间</th>
                  </tr>
                </thead>
                <tbody>
                  {fx.map((q) => (
                    <tr
                      key={q.code || q.currency}
                      className="border-t border-slate-50 hover:bg-emerald-50/40"
                    >
                      <td className="px-2.5 py-1.5">
                        <div className="font-black text-slate-800">{q.currency}</div>
                        <div className="text-[8px] font-bold text-slate-400">{q.code}</div>
                      </td>
                      <td className="px-1.5 py-1.5 text-right font-mono font-bold text-emerald-700 tabular-nums">
                        {q.bocBuy}
                      </td>
                      <td className="px-1.5 py-1.5 text-right font-mono font-bold text-rose-700 tabular-nums">
                        {q.bocSell}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono font-black text-slate-900 tabular-nums">
                        {q.bocMid}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <footer className="px-2.5 py-1 border-t border-slate-100 text-[8px] text-slate-400 font-medium shrink-0">
            中行牌价 · /100 外币
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
