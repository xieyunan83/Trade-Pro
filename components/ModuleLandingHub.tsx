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
    <div className="tp-landing relative -mx-1 sm:mx-0 space-y-3">
      {/* 紧凑顶栏：不再占半屏 */}
      <section className="relative rounded-2xl border border-cyan-200/60 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950 text-white overflow-hidden">
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

      {/* 情报三栏优先露在首屏 */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        {/* 行业新闻 */}
        <section className="xl:col-span-4 rounded-2xl border border-slate-200/80 bg-white/95 shadow-sm overflow-hidden flex flex-col max-h-[340px] min-h-[260px]">
          <header className="px-3 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-slate-900 text-cyan-300 flex items-center justify-center">
              <Newspaper size={14} />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900">行业新闻</h2>
              <p className="text-[10px] text-slate-500 font-medium">国内 · 国际 · 优选</p>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
            {loading && !news.length ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs font-bold p-4 justify-center">
                <Loader2 className="animate-spin" size={14} /> 拉取中…
              </div>
            ) : news.length === 0 ? (
              <p className="text-xs text-slate-500 font-medium p-4 text-center">资讯更新中，请刷新</p>
            ) : (
              news.slice(0, 12).map((n) => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-xl border border-transparent hover:border-cyan-200 hover:bg-cyan-50/50 px-2.5 py-2 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold text-slate-800 leading-snug line-clamp-2 group-hover:text-cyan-900">
                      {n.title}
                    </p>
                    <ExternalLink size={11} className="shrink-0 text-slate-300 mt-0.5 group-hover:text-cyan-600" />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[9px] font-bold text-slate-400">
                    <span className="rounded bg-slate-100 px-1 py-0.5 text-slate-600">{n.source}</span>
                    {n.region === 'intl' && (
                      <span className="rounded bg-sky-50 text-sky-700 px-1 py-0.5">国际</span>
                    )}
                    {n.region === 'cn' && (
                      <span className="rounded bg-emerald-50 text-emerald-700 px-1 py-0.5">国内</span>
                    )}
                    {n.region === 'industry' && (
                      <span className="rounded bg-violet-50 text-violet-700 px-1 py-0.5">优选</span>
                    )}
                  </div>
                </a>
              ))
            )}
          </div>
        </section>

        {/* 行业新品 */}
        <section className="xl:col-span-4 rounded-2xl border border-slate-200/80 bg-white/95 shadow-sm overflow-hidden flex flex-col max-h-[340px] min-h-[260px]">
          <header className="px-3 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-slate-900 text-amber-300 flex items-center justify-center">
              <Sparkles size={14} />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900">行业新品</h2>
              <p className="text-[10px] text-slate-500 font-medium">优选展区</p>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            {loading && products.length === 0 ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs font-bold p-4 justify-center">
                <Loader2 className="animate-spin" size={14} /> 拉取中…
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {products.slice(0, 8).map((p, idx) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-slate-100 bg-gradient-to-b from-white to-slate-50 p-2 hover:border-cyan-200 transition-all"
                  >
                    {p.image ? (
                      <img
                        src={p.image}
                        alt=""
                        width={240}
                        height={72}
                        className="w-full h-16 object-cover rounded-lg mb-1.5 bg-slate-100"
                        loading={idx < 4 ? 'eager' : 'lazy'}
                        decoding="async"
                        fetchPriority={idx < 2 ? 'high' : 'auto'}
                      />
                    ) : (
                      <div
                        className={`w-full h-12 rounded-lg mb-1.5 bg-gradient-to-br ${SHOWCASE_ACCENTS[idx % SHOWCASE_ACCENTS.length]} flex items-center justify-center text-slate-500/50`}
                      >
                        <Sparkles size={16} />
                      </div>
                    )}
                    <p className="text-[10px] font-bold text-slate-800 leading-snug line-clamp-2">{p.title}</p>
                    {p.specs && p.specs.length > 0 ? (
                      <p className="text-[9px] text-slate-500 font-medium mt-0.5 truncate">
                        {p.specs
                          .slice(0, 2)
                          .map((s) => `${s.label} ${s.value}`)
                          .join(' · ')}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 即时汇率 */}
        <section className="xl:col-span-4 rounded-2xl border border-slate-200/80 bg-white/95 shadow-sm overflow-hidden flex flex-col max-h-[340px] min-h-[260px]">
          <header className="px-3 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-slate-900 text-emerald-300 flex items-center justify-center">
              <LineChart size={14} />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900">即时汇率</h2>
              <p className="text-[10px] text-slate-500 font-medium">中行买入 / 卖出 / 中间价</p>
            </div>
          </header>
          <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar">
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
                    <th className="px-2.5 py-2">货币</th>
                    <th className="px-1.5 py-2 text-right">买入</th>
                    <th className="px-1.5 py-2 text-right">卖出</th>
                    <th className="px-2.5 py-2 text-right">中间价</th>
                  </tr>
                </thead>
                <tbody>
                  {fx.map((q) => (
                    <tr key={q.code || q.currency} className="border-t border-slate-50 hover:bg-cyan-50/40">
                      <td className="px-2.5 py-1.5">
                        <div className="font-black text-slate-800">{q.currency}</div>
                        <div className="text-[9px] font-bold text-slate-400">{q.code}</div>
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
          <footer className="px-2.5 py-1.5 border-t border-slate-100 text-[9px] text-slate-400 font-medium leading-relaxed">
            中国银行牌价 · 人民币 / 100 外币
            {fx[0]?.publishedAt ? ` · ${fx[0].publishedAt}` : ''}
          </footer>
        </section>
      </div>

      {/* 任务流置于情报下方，默认折叠定盘细节 */}
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
