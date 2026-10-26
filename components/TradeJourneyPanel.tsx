import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Compass,
  Map,
  Sparkles,
  Circle,
} from 'lucide-react';
import { ModuleType } from '../types';
import {
  ASSET_OPTIONS,
  JOURNEY_STAGES,
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
  /** 一键带剧本进入营销工具自动化 */
  onStartPlaybook?: (playbookId: string) => void;
};

export const TradeJourneyPanel: React.FC<Props> = ({
  progressHint,
  onNavigate,
  onStartPlaybook,
}) => {
  const [journey, setJourney] = useState<TradeJourneyState>(() => loadTradeJourney());
  const [marketPick, setMarketPick] = useState<string>(MARKET_PICK_OPTIONS[0].id);

  useEffect(() => {
    setJourney(loadTradeJourney());
  }, []);

  const skuCount = progressHint.skuCount || loadCatalogSkus().length;
  const active = useMemo(
    () => resolveActiveStage(journey, { ...progressHint, skuCount }),
    [journey, progressHint, skuCount]
  );

  const fit = useMemo(() => {
    if (!journey.productFocus.trim() || !journey.targetMarket.trim()) return null;
    return buildMarketFitAdvice({
      categoryOrName: journey.productFocus,
      targetMarket: journey.targetMarket,
    });
  }, [journey.productFocus, journey.targetMarket]);

  const save = (partial: Partial<TradeJourneyState>) => {
    const next = patchTradeJourney(partial);
    setJourney(next);
  };

  const applyMarketChip = (id: string) => {
    setMarketPick(id);
    const label = MARKET_PICK_OPTIONS.find((m) => m.id === id)?.label || id;
    save({ targetMarket: label });
  };

  const markStage = (id: (typeof JOURNEY_STAGES)[number]['id'], done: boolean) => {
    setJourney(toggleJourneyStage(id, done));
  };

  const setupComplete = !!(journey.asset && journey.targetMarket.trim() && journey.productFocus.trim());

  return (
    <section className="rounded-3xl border border-cyan-200/70 bg-white/95 backdrop-blur-md shadow-sm overflow-hidden mb-5">
      <header className="px-5 sm:px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950 text-white">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-cyan-400/20 text-cyan-300 flex items-center justify-center">
            <Compass size={20} />
          </div>
          <div>
            <h2 className="font-black text-lg tracking-tight">澄海玩具出口 · 任务流</h2>
            <p className="text-[11px] text-slate-300 font-medium">
              选品 → 报价 → 设计 → 获客 → 背调 → 开发 → CRM，小白也能按步骤跑通
            </p>
          </div>
        </div>
        <div className="text-[11px] font-bold text-cyan-200/90">
          进行中：{active.step}. {active.title}
        </div>
      </header>

      <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* 左：项目定盘 */}
        <div className="lg:col-span-5 space-y-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1">
              <Map size={12} /> ① 我有什么
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {ASSET_OPTIONS.map((opt) => {
                const on = journey.asset === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => save({ asset: opt.id })}
                    className={`text-left rounded-2xl border px-3 py-2.5 transition-all ${
                      on
                        ? 'border-cyan-400 bg-cyan-50 shadow-sm'
                        : 'border-slate-200 bg-slate-50/80 hover:border-cyan-200'
                    }`}
                  >
                    <div className="text-xs font-black text-slate-800">{opt.label}</div>
                    <div className="text-[10px] text-slate-500 font-medium mt-0.5 leading-snug">
                      {opt.tip}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
              ② 目标市场
            </p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {MARKET_PICK_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => applyMarketChip(m.id)}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                    marketPick === m.id || journey.targetMarket === m.label
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-cyan-300'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <input
              value={journey.targetMarket}
              onChange={(e) => save({ targetMarket: e.target.value })}
              placeholder="或填写具体国家，如 Germany"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
              ③ 主推品类 / 关键词
            </p>
            <input
              value={journey.productFocus}
              onChange={(e) => save({ productFocus: e.target.value })}
              placeholder="例如：磁力片积木、泡泡枪、遥控车"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
          </div>

          {fit ? (
            <div
              className={`rounded-2xl border p-3.5 ${
                fit.scoreTone === 'emerald'
                  ? 'border-emerald-200 bg-emerald-50/80'
                  : fit.scoreTone === 'rose'
                    ? 'border-rose-200 bg-rose-50/80'
                    : 'border-amber-200 bg-amber-50/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-black text-slate-800 flex items-center gap-1">
                  <Sparkles size={13} /> 适市速判 · {fit.market}
                </span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white/80 border border-black/5">
                  {fit.scoreLabel}
                </span>
              </div>
              <ul className="space-y-1 mb-2">
                {fit.highlights.map((h) => (
                  <li key={h} className="text-[11px] font-medium text-slate-700 leading-snug">
                    · {h}
                  </li>
                ))}
              </ul>
              <p className="text-[10px] font-bold text-slate-500 mb-1">包装要点</p>
              <p className="text-[11px] text-slate-600 font-medium leading-snug mb-2">
                {fit.packaging[0]}
              </p>
              <button
                type="button"
                onClick={() => {
                  save({ lastFitSummary: `${fit.scoreLabel} · ${fit.market}` });
                  onNavigate(ModuleType.PRODUCT_CATALOG);
                }}
                className="text-[11px] font-black text-cyan-800 hover:underline inline-flex items-center gap-1"
              >
                去产品库完善 SKU <ArrowRight size={12} />
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 font-medium">
              填完市场与品类后，将自动给出适市包装与功能提示。
            </p>
          )}
        </div>

        {/* 右：七步进度 + 下一步 */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3 sm:p-4">
            <div className="flex flex-wrap gap-2 mb-3 text-[10px] font-bold text-slate-500">
              <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200">
                产品库 {skuCount}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200">
                待背调 {progressHint.pendingTasks}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200">
                已背调 {progressHint.completedBg}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200">
                CRM {progressHint.crmCount}
              </span>
              {progressHint.failedTasks > 0 ? (
                <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100">
                  失败 {progressHint.failedTasks}
                </span>
              ) : null}
            </div>

            <ol className="space-y-1.5">
              {JOURNEY_STAGES.map((s) => {
                const done = journey.completedStages.includes(s.id);
                const isActive = active.id === s.id;
                return (
                  <li
                    key={s.id}
                    className={`flex items-stretch gap-2 rounded-xl border px-2.5 py-2 ${
                      isActive
                        ? 'border-cyan-300 bg-cyan-50/90 shadow-sm'
                        : done
                          ? 'border-emerald-100 bg-emerald-50/40'
                          : 'border-transparent bg-white/70'
                    }`}
                  >
                    <button
                      type="button"
                      title={done ? '标记未完成' : '标记已完成'}
                      onClick={() => markStage(s.id, !done)}
                      className="shrink-0 mt-0.5 text-slate-400 hover:text-emerald-600"
                    >
                      {done ? (
                        <CheckCircle2 size={16} className="text-emerald-600" />
                      ) : (
                        <Circle size={16} />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-400">{s.step}</span>
                        <span className="text-xs font-black text-slate-800">{s.title}</span>
                        {isActive ? (
                          <span className="text-[9px] font-black uppercase tracking-wide text-cyan-700 bg-cyan-100 px-1.5 py-0.5 rounded">
                            下一步
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[10px] text-slate-500 font-medium leading-snug mt-0.5">
                        {s.blurb}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate(s.module)}
                      className={`shrink-0 self-center text-[10px] font-black px-2.5 py-1.5 rounded-lg ${
                        isActive
                          ? 'bg-slate-900 text-white'
                          : 'bg-white border border-slate-200 text-slate-600 hover:border-cyan-300'
                      }`}
                    >
                      {s.cta}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
              推荐获客剧本（澄海玩具）
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ACQUISITION_PLAYBOOKS.slice(0, 4).map((pb) => (
                <button
                  key={pb.id}
                  type="button"
                  disabled={!onStartPlaybook}
                  onClick={() => {
                    if (journey.productFocus.trim()) {
                      save({
                        productFocus: journey.productFocus || pb.config.keyword,
                        targetMarket: journey.targetMarket || pb.marketTag,
                      });
                    } else {
                      save({
                        productFocus: pb.config.keyword,
                        targetMarket: pb.marketTag,
                        asset: journey.asset || 'factory',
                      });
                    }
                    onStartPlaybook?.(pb.id);
                  }}
                  className="text-left rounded-xl border border-slate-200 hover:border-cyan-300 hover:bg-cyan-50/50 px-3 py-2.5 transition-all disabled:opacity-50"
                >
                  <div className="text-xs font-black text-slate-800">{pb.title}</div>
                  <div className="text-[10px] text-slate-500 font-medium mt-0.5 line-clamp-2">
                    {pb.blurb}
                  </div>
                </button>
              ))}
            </div>
            {!setupComplete ? (
              <p className="text-[10px] text-amber-700 font-bold mt-2">
                建议先完成上方「我有什么 / 市场 / 品类」，剧本会更贴合你的项目。
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};
