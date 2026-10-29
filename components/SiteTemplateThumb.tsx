import React from 'react';
import type { SiteTemplateId } from '../services/siteBuilderTemplates';

/** 模板卡片缩略：迷你线框布局，避免「色块假模板」感 */
export const SiteTemplateThumb: React.FC<{ id: SiteTemplateId; accent: string }> = ({
  id,
  accent,
}) => {
  const bar = { background: accent };

  if (id === 'catalog_grid') {
    return (
      <div className="h-28 bg-slate-100 p-2 flex flex-col gap-1.5">
        <div className="h-2.5 rounded-sm bg-slate-800/90 w-full flex items-center px-1 gap-0.5">
          <span className="w-4 h-1 rounded-full bg-white/40" />
          <span className="ml-auto flex gap-0.5">
            <span className="w-2 h-1 rounded-full bg-white/25" />
            <span className="w-2 h-1 rounded-full bg-white/25" />
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 flex-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-sm bg-white border border-slate-200/80 p-0.5 flex flex-col gap-0.5 min-h-0"
            >
              <div className="flex-1 rounded-[1px] min-h-[10px]" style={{ background: `${accent}33` }} />
              <div className="h-0.5 rounded-full bg-slate-300" style={{ width: '70%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (id === 'inquiry_first') {
    return (
      <div className="h-28 bg-[#1c1917] p-2 flex gap-1.5">
        <div className="flex-1 flex flex-col gap-1 justify-center min-w-0">
          <div className="h-1.5 rounded-full bg-amber-200/80" style={{ width: '85%' }} />
          <div className="h-1 rounded-full bg-white/25" style={{ width: '60%' }} />
          <div className="h-1 rounded-full bg-white/15" style={{ width: '40%' }} />
          <div className="mt-1 h-3 w-10 rounded-sm" style={bar} />
        </div>
        <div className="w-[42%] rounded-md bg-white/95 p-1.5 flex flex-col gap-1 shadow">
          <div className="h-1 w-8 rounded-full bg-slate-300" />
          <div className="h-2 rounded-sm bg-slate-100 border border-slate-200" />
          <div className="h-2 rounded-sm bg-slate-100 border border-slate-200" />
          <div className="h-2.5 rounded-sm mt-auto" style={bar} />
        </div>
      </div>
    );
  }

  if (id === 'brand_story') {
    return (
      <div className="h-28 bg-rose-950 p-2 flex flex-col gap-1">
        <div className="h-8 rounded-sm overflow-hidden relative" style={{ background: `${accent}55` }}>
          <div className="absolute inset-x-2 bottom-1.5 space-y-0.5">
            <div className="h-1.5 rounded-full bg-white/90" style={{ width: '66%' }} />
            <div className="h-1 rounded-full bg-white/40" style={{ width: '50%' }} />
          </div>
        </div>
        <div className="flex-1 flex gap-1 min-h-0">
          <div className="flex-1 rounded-sm bg-white/10 p-1 space-y-0.5">
            <div className="h-1 w-full rounded-full bg-white/30" />
            <div className="h-1 rounded-full bg-white/20" style={{ width: '85%' }} />
            <div className="h-1 rounded-full bg-white/15" style={{ width: '70%' }} />
          </div>
          <div className="w-10 rounded-sm bg-rose-800/80" />
        </div>
      </div>
    );
  }

  if (id === 'minimal_clean') {
    return (
      <div className="h-28 bg-[#f8fafc] p-3 flex flex-col items-center justify-center gap-1.5">
        <div className="h-2 w-16 rounded-full bg-slate-800" />
        <div className="h-1 w-24 rounded-full bg-slate-300" />
        <div className="h-1 w-20 rounded-full bg-slate-200" />
        <div className="mt-1.5 h-3 w-12 rounded-full border border-slate-800" />
      </div>
    );
  }

  /* trade_hero */
  return (
    <div className="h-28 bg-slate-950 p-2 flex flex-col gap-1.5">
      <div className="h-2 rounded-sm bg-slate-800 flex items-center px-1 gap-1">
        <span className="w-3 h-1 rounded-full bg-teal-400/80" />
        <span className="ml-auto flex gap-0.5 items-center">
          <span className="w-2 h-1 rounded-full bg-white/20" />
          <span className="w-2 h-1 rounded-full bg-white/20" />
          <span className="w-3 h-1.5 rounded-sm" style={bar} />
        </span>
      </div>
      <div className="flex-1 rounded-sm bg-gradient-to-br from-slate-900 to-teal-950 p-1.5 flex flex-col justify-end gap-0.5 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background: `radial-gradient(ellipse at 80% 20%, ${accent}66, transparent 55%)`,
          }}
        />
        <div className="relative h-1.5 rounded-full bg-white/90" style={{ width: '75%' }} />
        <div className="relative h-1 rounded-full bg-white/35" style={{ width: '50%' }} />
        <div className="relative mt-0.5 h-2.5 w-10 rounded-sm" style={bar} />
      </div>
      <div className="grid grid-cols-3 gap-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-5 rounded-sm bg-slate-800/80 border border-white/5" />
        ))}
      </div>
    </div>
  );
};
