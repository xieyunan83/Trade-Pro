import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Circle,
  Link2,
  Sparkles,
} from 'lucide-react';
import { ModuleType } from '../types';
import {
  ASSET_OPTIONS,
  JOURNEY_STAGES,
  evaluateStageGate,
  loadTradeJourney,
  patchTradeJourney,
  resolveActiveStage,
  toggleJourneyStage,
  type JourneyProgressHint,
  type TradeJourneyState,
} from '../services/tradeJourney';
import { buildMarketFitAdvice, MARKET_PICK_OPTIONS } from '../services/marketFitAdvice';
import { ACQUISITION_PLAYBOOKS } from '../services/acquisitionPlaybooks';
import { loadCatalogSkus } from '../services/productCatalogTypes';

type Props = {
  progressHint: JourneyProgressHint;
  onNavigate: (mod: ModuleType) => void;
  onStartPlaybook?: (playbookId: string) => void;
};

export const TradeJourneyPanel: React.FC<Props> = ({
  progressHint,
  onNavigate,
  onStartPlaybook,
}) => {
  const [journey, setJourney] = useState<TradeJourneyState>(() => loadTradeJourney());
  const [marketPick, setMarketPick] = useState<string>(MARKET_PICK_OPTIONS[0].id);
  /** 着陆默认展开，页面更丰满 */
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    setJourney(loadTradeJourney());
  }, []);

  const skuCount = progressHint.skuCount || loadCatalogSkus().length;
  const hint = useMemo(
    () => ({ ...progressHint, skuCount }),
    [progressHint, skuCount]
  );
  const active = useMemo(
    () => resolveActiveStage(journey, hint),
    [journey, hint]
  );
  const activeGate = useMemo(
    () => evaluateStageGate(active, journey, hint),
    [active, journey, hint]
  );

  const fit = useMemo(() => {
    if (!journey.productFocus.trim() || !journey.targetMarket.trim()) return null;
    return buildMarketFitAdvice({
      categoryOrName: journey.productFocus,
      targetMarket: journey.targetMarket,
    });
  }, [journey.productFocus, journey.targetMarket]);

  const save = (partial: Partial<TradeJourneyState>) => {
    setJourney(patchTradeJourney(partial));
  };

  const applyMarketChip = (id: string) => {
    setMarketPick(id);
    const label = MARKET_PICK_OPTIONS.find((m) => m.id === id)?.label || id;
    save({ targetMarket: label });
  };

  const markStage = (id: (typeof JOURNEY_STAGES)[number]['id'], done: boolean) => {
    setJourney(toggleJourneyStage(id, done));
  };

  const goStage = (module: ModuleType) => {
    onNavigate(module);
  };

  return (
    <section className="rounded-2xl border border-cyan-200/70 bg-white/95 shadow-sm overflow-hidden mb-3">
      <div className="px-3 sm:px-4 py-2.5 flex flex-wrap items-center gap-2 sm:gap-3 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950 text-white">
        <Compass size={16} className="text-cyan-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black truncate">
            任务流 · {active.step}/{JOURNEY_STAGES.length} {active.title}
            {active.standalone ? (
              <span className="ml-1.5 font-bold text-cyan-200/80">· 可单做</span>
            ) : (
              <span className="ml-1.5 font-bold text-amber-200/90">· 需前置</span>
            )}
          </div>
          <div className="text-[10px] text-slate-300 font-medium truncate">{active.blurb}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-slate-300">
          <span>库 {skuCount}</span>
          <span>·</span>
          <span>待调 {progressHint.pendingTasks}</span>
          <span>·</span>
          <span>已调 {progressHint.completedBg}</span>
          <span>·</span>
          <span>CRM {progressHint.crmCount}</span>
          {progressHint.failedTasks > 0 ? (
            <span className="text-rose-300">· 失败 {progressHint.failedTasks}</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => goStage(active.module)}
          className="inline-flex items-center gap-1 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 px-3 py-1.5 text-[11px] font-black"
        >
          {active.cta} <ArrowRight size={12} />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 px-2.5 py-1.5 text-[11px] font-bold"
        >
          {expanded ? (
            <>
              收起 <ChevronUp size={12} />
            </>
          ) : (
            <>
              展开定盘 <ChevronDown size={12} />
            </>
          )}
        </button>
      </div>

      {!activeGate.ready && activeGate.blocker ? (
        <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-100 text-[10px] font-bold text-amber-900">
          {activeGate.blocker}
        </div>
      ) : null}

      <div className="px-2 sm:px-3 py-2 border-b border-slate-100 flex gap-1 overflow-x-auto custom-scrollbar">
        {JOURNEY_STAGES.map((s) => {
          const done = journey.completedStages.includes(s.id);
          const isActive = active.id === s.id;
          const gate = evaluateStageGate(s, journey, hint);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => goStage(s.module)}
              className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black border transition-colors ${
                isActive
                  ? 'bg-cyan-50 border-cyan-300 text-cyan-900'
                  : done
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : !gate.ready
                      ? 'bg-amber-50/80 border-amber-200 text-amber-800'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-cyan-200'
              }`}
              title={
                gate.blocker
                  ? gate.blocker
                  : `${s.blurb}${s.standalone ? '（可单做）' : '（需前置）'}`
              }
            >
              {done ? <CheckCircle2 size={11} /> : <Circle size={11} />}
              {s.step}.{s.title}
              {!s.standalone ? <Link2 size={10} className="opacity-70" /> : null}
            </button>
          );
        })}
      </div>

      <div className="px-2 sm:px-3 py-2 flex gap-1.5 overflow-x-auto custom-scrollbar border-b border-slate-50">
        <span className="shrink-0 self-center text-[10px] font-black text-slate-400 pr-1">剧本</span>
        {ACQUISITION_PLAYBOOKS.map((pb) => (
          <button
            key={pb.id}
            type="button"
            disabled={!onStartPlaybook}
            onClick={() => {
              save({
                productFocus: journey.productFocus.trim() || pb.config.keyword,
                targetMarket: journey.targetMarket.trim() || pb.marketTag,
                asset: journey.asset || 'factory',
              });
              onStartPlaybook?.(pb.id);
            }}
            className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 hover:border-cyan-300 hover:bg-cyan-50 px-2.5 py-1 text-[10px] font-black text-slate-700 disabled:opacity-50"
            title={pb.blurb}
          >
            {pb.title}
          </button>
        ))}
      </div>

      {expanded ? (
        <div className="p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-5 space-y-3">
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                我有什么 · 决定推荐路径
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ASSET_OPTIONS.map((opt) => {
                  const on = journey.asset === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => save({ asset: opt.id })}
                      title={opt.tip}
                      className={`text-[11px] font-black rounded-lg border px-2.5 py-1.5 ${
                        on
                          ? 'border-cyan-400 bg-cyan-50 text-cyan-900'
                          : 'border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {journey.asset ? (
                <p className="mt-1.5 text-[10px] text-slate-500 font-medium leading-snug">
                  {ASSET_OPTIONS.find((a) => a.id === journey.asset)?.tip}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1">
              {MARKET_PICK_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => applyMarketChip(m.id)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    marketPick === m.id || journey.targetMarket === m.label
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <input
              value={journey.targetMarket}
              onChange={(e) => save({ targetMarket: e.target.value })}
              placeholder="目标市场 / 国家"
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium"
            />
            <input
              value={journey.productFocus}
              onChange={(e) => save({ productFocus: e.target.value })}
              placeholder="主推品类 / 关键词"
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium"
            />
            {fit ? (
              <div
                className={`rounded-xl border px-2.5 py-2 text-[11px] font-medium ${
                  fit.scoreTone === 'emerald'
                    ? 'border-emerald-200 bg-emerald-50'
                    : fit.scoreTone === 'rose'
                      ? 'border-rose-200 bg-rose-50'
                      : 'border-amber-200 bg-amber-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2 font-black text-slate-800 mb-1">
                  <span className="inline-flex items-center gap-1">
                    <Sparkles size={12} /> {fit.market}
                  </span>
                  <span>{fit.scoreLabel}</span>
                </div>
                <p className="leading-snug text-slate-700">{fit.highlights[0]}</p>
                <p className="leading-snug text-slate-600 mt-1">包装：{fit.packaging[0]}</p>
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 font-medium leading-snug">
                填写市场与品类后，这里会给出适市建议摘要。
              </p>
            )}
          </div>

          <div className="lg:col-span-7">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wide">
                七步任务 · 可单做或按序推进
              </div>
              <span className="text-[9px] font-bold text-slate-400 inline-flex items-center gap-1">
                <Link2 size={10} /> 标记为需前置
              </span>
            </div>
            <ol className="space-y-1">
              {JOURNEY_STAGES.map((s) => {
                const done = journey.completedStages.includes(s.id);
                const isActive = active.id === s.id;
                const gate = evaluateStageGate(s, journey, hint);
                return (
                  <li
                    key={s.id}
                    className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 ${
                      isActive
                        ? 'border-cyan-300 bg-cyan-50'
                        : done
                          ? 'border-emerald-100 bg-emerald-50/50'
                          : !gate.ready
                            ? 'border-amber-100 bg-amber-50/40'
                            : 'border-slate-100 bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => markStage(s.id, !done)}
                      className="text-slate-400 hover:text-emerald-600 mt-0.5"
                      title={done ? '取消完成' : '标记完成'}
                    >
                      {done ? (
                        <CheckCircle2 size={14} className="text-emerald-600" />
                      ) : (
                        <Circle size={14} />
                      )}
                    </button>
                    <span className="text-[10px] font-black text-slate-400 w-3 mt-0.5">{s.step}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-black text-slate-800 flex flex-wrap items-center gap-1.5">
                        {s.title}
                        {s.standalone ? (
                          <span className="text-[9px] font-bold text-slate-400 border border-slate-200 rounded px-1">
                            可单做
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold text-amber-700 border border-amber-200 bg-amber-50 rounded px-1 inline-flex items-center gap-0.5">
                            <Link2 size={9} /> 需前置
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 leading-snug">{s.blurb}</div>
                      {!gate.ready && gate.blocker ? (
                        <div className="text-[9px] font-bold text-amber-800 mt-0.5">{gate.blocker}</div>
                      ) : gate.tip ? (
                        <div className="text-[9px] text-slate-400 mt-0.5">{gate.tip}</div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => goStage(s.module)}
                      className={`shrink-0 text-[10px] font-black px-2 py-1 rounded-md ${
                        isActive
                          ? 'bg-slate-900 text-white'
                          : 'border border-slate-200 text-slate-600'
                      }`}
                    >
                      {s.cta}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      ) : null}
    </section>
  );
};
