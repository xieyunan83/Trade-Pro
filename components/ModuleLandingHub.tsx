import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Newspaper,
  Sparkles,
  LineChart,
  RefreshCw,
  Loader2,
  ExternalLink,
  Radio,
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
  /** 管理员：打开数据接入说明（可选，前台看板不展示接入文案） */
  onOpenDataSetup?: () => void;
  /** 任务流模块跳转 */
  onNavigateModule?: (mod: ModuleType) => void;
  /** 一键启动获客剧本 */
  onStartPlaybook?: (playbookId: string) => void;
  journeyProgress?: JourneyProgressHint;
};

const SHOWCASE_ACCENTS = [
  'from-cyan-100 to-sky-50',
  'from-amber-100 to-orange-50',
  'from-emerald-100 to-teal-50',
  'from-violet-100 to-fuchsia-50',
  'from-rose-100 to-pink-50',
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
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(async (force = false) => {
    const cur = dataRef.current;
    const hasPaint =
      (cur.fx?.quotes?.length || 0) > 0 ||
      (cur.news?.items?.length || 0) > 0 ||
      (cur.products?.items?.length || 0) > 0;
    // 已有内容时静默刷新，避免整页转圈
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
      .slice(0, 2)
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

  return (
    <div className="tp-landing relative min-h-[70vh] -mx-1 sm:mx-0">
      {/* 氛围层 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl"
      >
        <div className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute top-40 -left-20 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.04) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
      </div>

      <section className="relative mb-6 sm:mb-8 rounded-3xl border border-cyan-200/60 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 text-white overflow-hidden shadow-xl shadow-cyan-900/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(34,211,238,0.18),transparent_55%)]" />
        <div className="relative px-5 sm:px-8 py-7 sm:py-9 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300/90 mb-3">
              <Radio size={12} className="animate-pulse" /> Command Hub
            </div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight">
              外贸智慧协同
            </h1>
            <p className="mt-2 text-sm sm:text-base text-slate-300 font-medium max-w-xl leading-relaxed">
              你好，{currentUser.username}。用任务流跑通澄海玩具出口：选品适市 → 获客背调 → 开发成交。
            </p>
            {data?.fetchedAt ? (
              <p className="mt-3 text-[11px] font-bold text-slate-400">
                情报刷新 {fmtTime(data.fetchedAt)}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 px-4 py-2.5 text-sm font-extrabold disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              刷新情报
            </button>
            {onEnterWorkspace && (
              <button
                type="button"
                onClick={onEnterWorkspace}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 px-4 py-2.5 text-sm font-extrabold"
              >
                进入客户搜索
              </button>
            )}
            {onNavigateModule && (
              <button
                type="button"
                onClick={() => onNavigateModule(ModuleType.PROMO_GENERATOR)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 px-4 py-2.5 text-sm font-extrabold"
              >
                自动化获客
              </button>
            )}
          </div>
        </div>
      </section>

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

      {err && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-950 px-4 py-3 text-sm font-bold">
          部分情报暂未刷新，可稍后点「刷新情报」；亦可直接「进入客户搜索」开始工作。
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 sm:gap-5">
        {/* 行业新闻 */}
        <section className="xl:col-span-4 rounded-3xl border border-slate-200/80 bg-white/90 backdrop-blur-md shadow-sm overflow-hidden flex flex-col min-h-[420px]">
          <header className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-slate-900 text-cyan-300 flex items-center justify-center">
                <Newspaper size={16} />
              </div>
              <div>
                <h2 className="font-black text-slate-900">行业新闻</h2>
                <p className="text-[11px] text-slate-500 font-medium">国内 · 国际 · 优选资讯</p>
              </div>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 sm:p-4 space-y-2">
            {loading && !news.length ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm font-bold p-6 justify-center">
                <Loader2 className="animate-spin" size={16} /> 拉取中…
              </div>
            ) : news.length === 0 ? (
              <p className="text-sm text-slate-500 font-medium p-6 text-center">资讯更新中，请稍后刷新</p>
            ) : (
              news.map((n) => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-2xl border border-transparent hover:border-cyan-200 hover:bg-cyan-50/50 px-3 py-2.5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-slate-800 leading-snug group-hover:text-cyan-900">
                      {n.title}
                    </p>
                    <ExternalLink size={12} className="shrink-0 text-slate-300 mt-1 group-hover:text-cyan-600" />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-bold text-slate-400">
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-600">{n.source}</span>
                    {n.region === 'intl' && (
                      <span className="rounded-md bg-sky-50 text-sky-700 px-1.5 py-0.5">国际</span>
                    )}
                    {n.region === 'cn' && (
                      <span className="rounded-md bg-emerald-50 text-emerald-700 px-1.5 py-0.5">国内</span>
                    )}
                    {n.region === 'industry' && (
                      <span className="rounded-md bg-violet-50 text-violet-700 px-1.5 py-0.5">优选</span>
                    )}
                  </div>
                </a>
              ))
            )}
          </div>
        </section>

        {/* 行业新品 */}
        <section className="xl:col-span-4 rounded-3xl border border-slate-200/80 bg-white/90 backdrop-blur-md shadow-sm overflow-hidden flex flex-col min-h-[420px]">
          <header className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-slate-900 text-amber-300 flex items-center justify-center">
                <Sparkles size={16} />
              </div>
              <div>
                <h2 className="font-black text-slate-900">行业新品</h2>
                <p className="text-[11px] text-slate-500 font-medium">优选展区动态</p>
              </div>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 sm:p-4">
            {loading && products.length === 0 ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm font-bold p-6 justify-center">
                <Loader2 className="animate-spin" size={16} /> 拉取中…
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {products.slice(0, 10).map((p, idx) => (
                  <div
                    key={p.id}
                    className="rounded-2xl border border-slate-100 bg-gradient-to-b from-white to-slate-50 p-3 hover:border-cyan-200 hover:shadow-md transition-all"
                  >
                    {p.image ? (
                      <img
                        src={p.image}
                        alt=""
                        width={320}
                        height={112}
                        className="w-full h-28 object-cover rounded-xl mb-2 bg-slate-100"
                        loading={idx < 4 ? 'eager' : 'lazy'}
                        decoding="async"
                        fetchPriority={idx < 2 ? 'high' : 'auto'}
                      />
                    ) : (
                      <div
                        className={`w-full h-16 rounded-xl mb-2 bg-gradient-to-br ${SHOWCASE_ACCENTS[idx % SHOWCASE_ACCENTS.length]} flex items-center justify-center text-slate-500/50`}
                      >
                        <Sparkles size={22} />
                      </div>
                    )}
                    <p className="text-xs font-bold text-slate-800 leading-snug line-clamp-2">{p.title}</p>
                    {p.specs && p.specs.length > 0 ? (
                      <ul className="mt-1.5 space-y-0.5">
                        {p.specs.slice(0, 3).map((s) => (
                          <li
                            key={`${p.id}-${s.label}`}
                            className="text-[10px] text-slate-500 font-medium flex gap-1 leading-tight"
                          >
                            <span className="text-slate-400 shrink-0">{s.label}</span>
                            <span className="font-bold text-slate-700 truncate">{s.value}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="text-[10px] text-slate-400 font-bold mt-1">{p.source || '优选展区'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 即时汇率 */}
        <section className="xl:col-span-4 rounded-3xl border border-slate-200/80 bg-white/90 backdrop-blur-md shadow-sm overflow-hidden flex flex-col min-h-[420px]">
          <header className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-slate-900 text-emerald-300 flex items-center justify-center">
                <LineChart size={16} />
              </div>
              <div>
                <h2 className="font-black text-slate-900">即时汇率</h2>
                <p className="text-[11px] text-slate-500 font-medium">中行买入 / 卖出 / 中间价</p>
              </div>
            </div>
          </header>
          <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar">
            {loading && !fx.length ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm font-bold p-6 justify-center">
                <Loader2 className="animate-spin" size={16} /> 拉取中行牌价…
              </div>
            ) : fx.length === 0 ? (
              <p className="text-sm text-slate-500 font-medium p-4 text-center">
                {data?.fx?.error || '暂无汇率数据'}
              </p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500 font-black">
                  <tr>
                    <th className="px-3 py-2.5">货币</th>
                    <th className="px-2 py-2.5 text-right">中行买入</th>
                    <th className="px-2 py-2.5 text-right">中行卖出</th>
                    <th className="px-3 py-2.5 text-right">中间价</th>
                  </tr>
                </thead>
                <tbody>
                  {fx.map((q) => (
                    <tr key={q.code || q.currency} className="border-t border-slate-50 hover:bg-cyan-50/40">
                      <td className="px-3 py-2.5">
                        <div className="font-black text-slate-800">{q.currency}</div>
                        <div className="text-[10px] font-bold text-slate-400">{q.code}</div>
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono font-bold text-emerald-700 tabular-nums">
                        {q.bocBuy}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono font-bold text-rose-700 tabular-nums">
                        {q.bocSell}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-black text-slate-900 tabular-nums">
                        {q.bocMid}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <footer className="px-4 py-3 border-t border-slate-100 text-[10px] text-slate-400 font-medium leading-relaxed">
            {data?.fx?.note ||
              '数据来源：中国银行外汇牌价。中间价为中行折算价。单位：人民币 / 100 外币。'}
            {fx[0]?.publishedAt ? ` 发布 ${fx[0].publishedAt}` : ''}
          </footer>
        </section>
      </div>
    </div>
  );
};
