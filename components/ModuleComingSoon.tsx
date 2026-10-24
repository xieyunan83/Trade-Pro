import React from 'react';
import { Construction, Sparkles } from 'lucide-react';
import { findNavItem, findSectionByModule } from '../services/platformSections';
import { ModuleType } from '../types';

type Props = {
  module: ModuleType;
};

/** 新板块占位页：框架已挂导航，功能后续迭代，不影响既有模块与数据 */
export const ModuleComingSoon: React.FC<Props> = ({ module }) => {
  const item = findNavItem(module);
  const section = findSectionByModule(module);
  const Icon = item?.icon || Construction;

  return (
    <div className="max-w-[90rem] mx-auto animate-fade-in px-1">
      <div className="relative overflow-hidden rounded-3xl border border-cyan-200/60 bg-white/90 shadow-signal p-8 sm:p-12">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-40 blur-3xl"
          style={{ background: section?.accent || '#22d3ee' }}
        />
        <div className="relative flex flex-col sm:flex-row gap-6 items-start">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl border shadow-sm"
            style={{
              background: `linear-gradient(135deg, ${(section?.accent || '#22d3ee')}33, transparent)`,
              borderColor: `${section?.accent || '#22d3ee'}55`,
              color: section?.accent || '#0891b2',
            }}
          >
            <Icon size={28} />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 text-cyan-200 text-[10px] font-black uppercase tracking-widest px-3 py-1">
              <Sparkles size={12} /> {section?.label || '新板块'} · 框架就绪
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {item?.label || '功能筹备中'}
            </h2>
            <p className="text-sm font-semibold text-slate-500 leading-relaxed max-w-2xl">
              本模块已纳入「{section?.label || '平台'}」导航与权限体系，业务能力将在后续迭代上线。
              现有商机 / CRM / 邮件等模块与本地、云端数据库互不影响，可照常使用。
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <span className="text-[11px] font-black text-slate-400 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg">
                {item?.sub || module}
              </span>
              <span className="text-[11px] font-black text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-lg">
                Coming Soon
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
