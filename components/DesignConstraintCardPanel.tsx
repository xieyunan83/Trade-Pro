import React, { useEffect, useState } from 'react';
import { Compass, Loader2, Palette, Package, BadgeDollarSign } from 'lucide-react';
import { loadTradeJourney } from '../services/tradeJourney';
import { loadProductCatalog } from '../services/productCatalog';
import {
  buildDesignConstraintCard,
  type DesignConstraintCard,
} from '../services/designConstraintCard';
import { loadCatalogSkus } from '../services/productCatalogTypes';

type Props = {
  categoryOrName: string;
  targetMarket?: string;
  priceBandText?: string;
  /** 货号：用于读取我方出厂价 */
  skuCode?: string;
  compact?: boolean;
  onCardReady?: (card: DesignConstraintCard) => void;
};

const tone = (c: DesignConstraintCard['confidence']) =>
  c === '高' ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : c === '中' ? 'text-amber-800 bg-amber-50 border-amber-100' : 'text-slate-600 bg-slate-50 border-slate-200';

/**
 * 设计前 / 匹配前：客户画像约束卡 + 定价置信度（D+E）
 */
export const DesignConstraintCardPanel: React.FC<Props> = ({
  categoryOrName,
  targetMarket,
  priceBandText,
  skuCode,
  compact,
  onCardReady,
}) => {
  const [card, setCard] = useState<DesignConstraintCard | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const cat = (categoryOrName || '').trim();
      if (!cat) {
        setCard(null);
        return;
      }
      setLoading(true);
      try {
        const journey = loadTradeJourney();
        const profiles = await loadProductCatalog();
        const sku = (skuCode || '').trim()
          ? loadCatalogSkus().find(
              (s) =>
                s.skuCode.toLowerCase() === skuCode!.trim().toLowerCase() ||
                s.id === skuCode
            )
          : undefined;
        const factory =
          sku?.factoryPrice != null && sku.factoryPrice > 0
            ? sku.currency === 'USD'
              ? sku.factoryPrice * 7.2
              : sku.currency === 'EUR'
                ? sku.factoryPrice * 7.8
                : sku.factoryPrice
            : undefined;
        const next = buildDesignConstraintCard({
          categoryOrName: cat,
          targetMarket: targetMarket || journey.targetMarket || undefined,
          profiles,
          ourFactoryCny: factory,
          priceBandText,
        });
        if (!cancelled) {
          setCard(next);
          onCardReady?.(next);
        }
      } catch {
        if (!cancelled) setCard(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const t = window.setTimeout(() => void run(), 280);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [categoryOrName, targetMarket, priceBandText, skuCode, onCardReady]);

  if (!categoryOrName.trim()) return null;

  return (
    <div
      className={`rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/60 via-white to-teal-50/40 ${
        compact ? 'p-3' : 'p-4'
      } space-y-3`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Compass size={16} className="text-violet-600" />
          <div>
            <div className="text-sm font-black text-slate-800">设计适市约束</div>
            <div className="text-[10px] font-bold text-slate-400">
              来自客户库画像 · 设计前参考 · 完成后可匹配客户
            </div>
          </div>
        </div>
        {loading ? (
          <Loader2 size={14} className="animate-spin text-violet-500" />
        ) : card ? (
          <span
            className={`text-[10px] font-black px-2 py-1 rounded-lg border ${tone(card.confidence)}`}
          >
            置信{card.confidence} {card.confidenceScore}
          </span>
        ) : null}
      </div>

      {card && (
        <>
          <div className="flex flex-wrap gap-1.5 text-[10px] font-bold text-slate-600">
            <span className="px-2 py-1 rounded-lg bg-white border border-slate-100">
              {card.market}
            </span>
            <span className="px-2 py-1 rounded-lg bg-white border border-slate-100">
              {card.category}
            </span>
            <span className="px-2 py-1 rounded-lg bg-white border border-slate-100">
              样本 {card.sampleSize} · 信号齐 {card.designReadyCount}
            </span>
          </div>

          <ul className="space-y-1.5">
            {card.designHints.map((h) => (
              <li key={h} className="text-xs font-bold text-slate-700 leading-relaxed flex gap-2">
                <span className="text-violet-500 shrink-0">·</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>

          {!compact && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="rounded-xl bg-white/80 border border-slate-100 p-2.5">
                <div className="flex items-center gap-1 text-[10px] font-black text-slate-400 mb-1">
                  <Package size={12} /> 包装
                </div>
                <div className="text-[11px] font-bold text-slate-700">
                  {card.packagingStyles.slice(0, 4).join('、') ||
                    card.marketFitPackaging[0] ||
                    '库内暂缺，可参考适市通则'}
                </div>
              </div>
              <div className="rounded-xl bg-white/80 border border-slate-100 p-2.5">
                <div className="flex items-center gap-1 text-[10px] font-black text-slate-400 mb-1">
                  <Palette size={12} /> 配色
                </div>
                <div className="text-[11px] font-bold text-slate-700">
                  {card.colorPalettes.slice(0, 4).join('、') ||
                    card.colorPreference?.slice(0, 48) ||
                    '库内暂缺'}
                </div>
              </div>
              <div className="rounded-xl bg-white/80 border border-slate-100 p-2.5">
                <div className="flex items-center gap-1 text-[10px] font-black text-slate-400 mb-1">
                  <BadgeDollarSign size={12} /> 定价
                </div>
                <div className="text-[11px] font-bold text-slate-700">
                  {card.pricing?.suggestedFactory
                    ? `建议出厂 ¥${card.pricing.suggestedFactory.min}–${card.pricing.suggestedFactory.max}`
                    : '证据不足'}
                </div>
                {card.pricing && (
                  <div className="text-[10px] font-bold text-teal-700 mt-0.5">
                    {card.pricing.verdict}
                    {card.pricing.evidenceTier ? ` · ${card.pricing.evidenceTier}` : ''}
                  </div>
                )}
              </div>
            </div>
          )}
          {card.hintSources?.includes('industry_heuristic') &&
            !card.hintSources.includes('library') && (
              <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
                当前主要依据行业通则，库内观察不足；补全客户信号后再设计/定价更可靠。
              </p>
            )}

          {!compact && card.topCustomers.length > 0 && (
            <div className="text-[10px] font-bold text-slate-500">
              参考客户：
              {card.topCustomers
                .map((c) => `${c.name}${c.country ? `(${c.country})` : ''}`)
                .join(' · ')}
            </div>
          )}
        </>
      )}
    </div>
  );
};
