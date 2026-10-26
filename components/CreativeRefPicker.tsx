import React, { useMemo, useState } from 'react';
import { ImagePlus, Package, Sparkles, X, Check } from 'lucide-react';
import {
  CREATIVE_PIPELINE,
  listCatalogRefItems,
  listDesignRefItems,
  type CreativeRefItem,
} from '../services/creativeAssetBridge';
import type { ModuleType } from '../types';

type Props = {
  /** 已选图片 URL */
  value: string[];
  onChange: (urls: string[]) => void;
  /** 单选（3D）或多选（视频） */
  multiple?: boolean;
  max?: number;
  accent?: 'indigo' | 'rose' | 'violet';
  title?: string;
  onSkuMeta?: (meta: { skuCode?: string; skuName?: string } | null) => void;
};

/**
 * 从「平面设计资产 / 产品库」挑选参考图，三模块共用。
 */
export const CreativeRefPicker: React.FC<Props> = ({
  value,
  onChange,
  multiple = false,
  max = 6,
  accent = 'indigo',
  title = '选用已有素材',
  onSkuMeta,
}) => {
  const [tab, setTab] = useState<'design' | 'catalog'>('design');
  const [tick, setTick] = useState(0);
  const designItems = useMemo(() => listDesignRefItems(48), [tick]);
  const catalogItems = useMemo(() => listCatalogRefItems(60), [tick]);
  const items = tab === 'design' ? designItems : catalogItems;

  const ring =
    accent === 'rose'
      ? 'border-rose-400 ring-1 ring-rose-200'
      : accent === 'violet'
        ? 'border-violet-400 ring-1 ring-violet-200'
        : 'border-indigo-400 ring-1 ring-indigo-200';
  const tabActive =
    accent === 'rose'
      ? 'bg-rose-600 text-white'
      : accent === 'violet'
        ? 'bg-violet-600 text-white'
        : 'bg-indigo-600 text-white';

  const toggle = (item: CreativeRefItem) => {
    const has = value.includes(item.url);
    if (multiple) {
      if (has) {
        onChange(value.filter((u) => u !== item.url));
      } else {
        onChange([...value, item.url].slice(0, max));
      }
    } else {
      onChange(has ? [] : [item.url]);
    }
    if (onSkuMeta) {
      onSkuMeta(
        item.skuCode || item.skuName
          ? { skuCode: item.skuCode, skuName: item.skuName }
          : null
      );
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1">
          <ImagePlus size={11} /> {title}
        </div>
        <div className="flex rounded-lg overflow-hidden border border-slate-200 text-[10px] font-black">
          <button
            type="button"
            onClick={() => {
              setTab('design');
              setTick((n) => n + 1);
            }}
            className={`px-2 py-1 inline-flex items-center gap-0.5 ${
              tab === 'design' ? tabActive : 'bg-white text-slate-500'
            }`}
          >
            <Sparkles size={10} /> 平面设计
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('catalog');
              setTick((n) => n + 1);
            }}
            className={`px-2 py-1 inline-flex items-center gap-0.5 ${
              tab === 'catalog' ? tabActive : 'bg-white text-slate-500'
            }`}
          >
            <Package size={10} /> 产品库
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] text-slate-400 font-medium px-1 py-3 text-center">
          {tab === 'design'
            ? '暂无平面设计出图。请先到「产品设计 · 平面图」生成主图 / 多角度套图。'
            : '产品库暂无图片。请先在产品库上传或导入带图 SKU。'}
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5 max-h-36 overflow-y-auto custom-scrollbar">
          {items.map((item) => {
            const selected = value.includes(item.url);
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                onClick={() => toggle(item)}
                className={`relative aspect-square rounded-lg overflow-hidden border bg-white ${
                  selected ? ring : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <img src={item.url} alt="" className="w-full h-full object-contain p-0.5" />
                {selected && (
                  <span className="absolute top-0.5 right-0.5 rounded-full bg-slate-900 text-white p-0.5">
                    <Check size={10} />
                  </span>
                )}
                {item.angle ? (
                  <span className="absolute bottom-0.5 left-0.5 text-[8px] font-black bg-black/60 text-white px-1 rounded">
                    {item.angle}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {value.length > 0 && (
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-[10px] font-bold text-slate-500">已选 {value.length} 张</span>
          <button
            type="button"
            onClick={() => {
              onChange([]);
              onSkuMeta?.(null);
            }}
            className="text-[10px] font-black text-slate-400 hover:text-rose-600 inline-flex items-center gap-0.5"
          >
            <X size={10} /> 清空选用
          </button>
        </div>
      )}
    </div>
  );
};

/** 三模块顶部共用的流水线导航条 */
export const CreativePipelineBar: React.FC<{
  current: '2d' | '3d' | 'video';
  onNavigate?: (mod: ModuleType) => void;
}> = ({ current, onNavigate }) => {
  if (!onNavigate) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black">
      <span className="text-slate-400 uppercase tracking-wider mr-1">创作流水线</span>
      {CREATIVE_PIPELINE.map((step, i) => {
        const active =
          (current === '2d' && step.id === '2d') ||
          (current === '3d' && step.id === '3d') ||
          (current === 'video' && step.id === 'video');
        return (
          <React.Fragment key={step.id}>
            {i > 0 ? <span className="text-slate-300">→</span> : null}
            <button
              type="button"
              onClick={() => onNavigate(step.module)}
              className={`rounded-lg px-2.5 py-1 border transition-colors ${
                active
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-cyan-300 hover:text-cyan-800'
              }`}
              title={step.blurb}
            >
              {step.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};
