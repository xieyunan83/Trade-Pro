import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Lightbulb,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Users,
  FileSpreadsheet,
  Package,
  XCircle,
} from 'lucide-react';
import type { HistoryItem, User } from '../types';
import { ModuleType } from '../types';
import {
  getOpsDailyDigest,
  refreshOpsDailyDigest,
  type OpsDailyDigest,
  type OpsDailyMetrics,
} from '../services/userOpsLog';

type Props = {
  currentUser: User;
  history?: HistoryItem[];
  onNavigateModule?: (mod: ModuleType) => void;
};

const METRIC_CARDS: Array<{
  key: keyof OpsDailyMetrics;
  label: string;
  icon: React.ReactNode;
  accent: string;
}> = [
  {
    key: 'search',
    label: '客户搜索',
    icon: <Search size={14} />,
    accent: 'from-sky-500/20 to-sky-500/5 text-sky-200',
  },
  {
    key: 'analysis',
    label: '背调完成',
    icon: <Shield size={14} />,
    accent: 'from-violet-500/20 to-violet-500/5 text-violet-200',
  },
  {
    key: 'decisionMakers',
    label: '决策人',
    icon: <Users size={14} />,
    accent: 'from-teal-500/20 to-teal-500/5 text-teal-200',
  },
  {
    key: 'designs',
    label: '设计/出图',
    icon: <Sparkles size={14} />,
    accent: 'from-amber-500/20 to-amber-500/5 text-amber-200',
  },
  {
    key: 'quotes',
    label: '报价单',
    icon: <FileSpreadsheet size={14} />,
    accent: 'from-cyan-500/20 to-cyan-500/5 text-cyan-200',
  },
  {
    key: 'emailOk',
    label: '推送成功',
    icon: <CheckCircle2 size={14} />,
    accent: 'from-emerald-500/20 to-emerald-500/5 text-emerald-200',
  },
  {
    key: 'emailFail',
    label: '推送失败',
    icon: <XCircle size={14} />,
    accent: 'from-rose-500/20 to-rose-500/5 text-rose-200',
  },
  {
    key: 'catalogWrites',
    label: '产品库更新',
    icon: <Package size={14} />,
    accent: 'from-indigo-500/20 to-indigo-500/5 text-indigo-200',
  },
];

const AnimatedNum: React.FC<{ value: number; active: boolean }> = ({ value, active }) => {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) {
      setN(value);
      return;
    }
    let raf = 0;
    const from = 0;
    const to = value;
    const start = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, active]);
  return <span className="tabular-nums">{n}</span>;
};

export const LandingOpsPulse: React.FC<Props> = ({
  currentUser,
  history = [],
  onNavigateModule,
}) => {
  const [digest, setDigest] = useState<OpsDailyDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulse, setPulse] = useState(false);

  const rebuild = (force = false) => {
    setLoading(true);
    try {
      const d = force
        ? refreshOpsDailyDigest(currentUser.username, {
            username: currentUser.username,
            history,
          })
        : getOpsDailyDigest(currentUser.username, {
            username: currentUser.username,
            history,
          });
      setDigest(d);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 1200);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    rebuild(false);
    // 仅账号/历史长度变化时重建入口；日更锁定由 store 控制
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.username, history.length]);

  const m = digest?.metrics;
  const score = m?.score ?? 0;
  const scoreRing = useMemo(() => {
    const r = 34;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - Math.min(100, score) / 100);
    return { c, offset };
  }, [score]);

  const goHint = (text: string) => {
    if (!onNavigateModule) return;
    if (/背调|决策人/.test(text)) onNavigateModule(ModuleType.PROMO_GENERATOR);
    else if (/报价/.test(text)) onNavigateModule(ModuleType.PRODUCT_QUOTE);
    else if (/发信|邮件|无效/.test(text)) onNavigateModule(ModuleType.EMAIL_CAMPAIGN);
    else if (/产品库|货号/.test(text)) onNavigateModule(ModuleType.PRODUCT_CATALOG);
    else if (/设计|出图/.test(text)) onNavigateModule(ModuleType.PRODUCT_DESIGN_2D);
    else onNavigateModule(ModuleType.DISCOVERY);
  };

  return (
    <section className="tp-ops-pulse relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white shadow-[0_20px_60px_-30px_rgba(15,118,110,0.55)]">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="tp-ops-orb absolute -top-16 -right-10 h-48 w-48 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="tp-ops-orb-delay absolute -bottom-20 left-10 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(45,212,191,0.06)_40%,transparent_70%)] tp-ops-sheen" />
      </div>

      <header className="relative z-[1] px-3 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-white/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-teal-400/15 border border-teal-300/30 text-teal-200 flex items-center justify-center shrink-0">
            <Activity size={16} className={pulse ? 'animate-pulse' : ''} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold tracking-tight">今日操作日志</h2>
              <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-300/85">
                <span className="tp-live-dot inline-block h-1.5 w-1.5 rounded-full bg-teal-400" />
                Daily Pulse
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-medium">
              {digest?.date || '—'} · 按账号日更一次 · 汇总搜索 / 背调 / 决策人 / 设计 / 报价 / 推送
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => rebuild(true)}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
          title="用最新本地数据重建今日汇总"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          刷新今日
        </button>
      </header>

      <div className="relative z-[1] p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* 分数环 */}
        <div className="lg:col-span-3 rounded-xl border border-white/10 bg-white/5 p-3 flex items-center gap-3">
          <div className="relative h-[88px] w-[88px] shrink-0">
            <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
              <circle
                cx="40"
                cy="40"
                r="34"
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="7"
              />
              <circle
                cx="40"
                cy="40"
                r="34"
                fill="none"
                stroke="url(#opsScoreGrad)"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={scoreRing.c}
                strokeDashoffset={scoreRing.offset}
                className="tp-ops-ring"
              />
              <defs>
                <linearGradient id="opsScoreGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#5eead4" />
                  <stop offset="100%" stopColor="#22d3ee" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-xl font-black text-white tabular-nums leading-none">
                <AnimatedNum value={score} active={pulse || loading === false} />
              </div>
              <div className="text-[9px] font-bold text-teal-300/90 tracking-wider mt-0.5">活跃分</div>
            </div>
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-bold text-slate-100">今日业务脉搏</p>
            <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
              综合搜索、背调、触达与报价产出。分数每日固定一版，便于自我复盘。
            </p>
          </div>
        </div>

        {/* 指标网格 */}
        <div className="lg:col-span-9 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {METRIC_CARDS.map((card) => {
            const val = m ? Number(m[card.key]) || 0 : 0;
            return (
              <div
                key={card.key}
                className={`rounded-xl border border-white/10 bg-gradient-to-br ${card.accent} px-2.5 py-2.5 min-h-[72px]`}
              >
                <div className="flex items-center justify-between gap-1 text-[10px] font-bold opacity-90">
                  <span className="inline-flex items-center gap-1">
                    {card.icon}
                    {card.label}
                  </span>
                </div>
                <div className="mt-1.5 text-2xl font-black tracking-tight text-white">
                  <AnimatedNum value={val} active />
                </div>
              </div>
            );
          })}
        </div>

        {/* 点评 + 建议 */}
        <div className="lg:col-span-7 rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-teal-200 text-xs font-bold">
            <Lightbulb size={13} /> 专业点评
          </div>
          <p className="text-xs text-slate-200 font-medium leading-relaxed">
            {digest?.commentary || (loading ? '汇总中…' : '暂无点评')}
          </p>
        </div>
        <div className="lg:col-span-5 rounded-xl border border-teal-400/20 bg-teal-400/5 p-3 space-y-2">
          <div className="text-xs font-bold text-teal-100">下一步行动建议</div>
          <ul className="space-y-1.5">
            {(digest?.nextActions || []).map((a, i) => (
              <li key={`${i}-${a}`}>
                <button
                  type="button"
                  onClick={() => goHint(a)}
                  className="w-full text-left group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/10 transition-colors"
                >
                  <span className="mt-0.5 text-[10px] font-mono font-bold text-teal-300/80">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="flex-1 text-[11px] font-semibold text-slate-100 leading-snug">
                    {a}
                  </span>
                  <ArrowRight
                    size={12}
                    className="shrink-0 text-slate-500 group-hover:text-teal-300 mt-0.5"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* 最近动作流 */}
        <div className="lg:col-span-12 rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-bold text-slate-300">今日动作流</span>
            <span className="text-[9px] font-mono text-slate-500">
              {digest?.events?.length || 0} events
            </span>
          </div>
          {!digest?.events?.length ? (
            <p className="text-[11px] text-slate-500 font-medium py-2">
              暂无逐条事件。完成搜索、背调、报价或发信后，将自动出现在此（并计入上方日汇总）。
            </p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
              {digest.events.slice(0, 16).map((e) => (
                <div
                  key={e.id}
                  className="shrink-0 max-w-[200px] rounded-lg border border-white/10 bg-white/5 px-2.5 py-2"
                >
                  <div className="text-[9px] font-mono text-teal-300/80">
                    {new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false })}
                  </div>
                  <div className="text-[11px] font-bold text-slate-100 truncate mt-0.5">
                    {e.label}
                  </div>
                  {e.meta ? (
                    <div className="text-[9px] text-slate-500 truncate mt-0.5">{e.meta}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
