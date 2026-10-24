import React from 'react';
import { Construction, Sparkles, ListChecks, Layers } from 'lucide-react';
import { findNavItem, findSectionByModule } from '../services/platformSections';
import { MODULE_ROADMAP, PHASE_LABEL } from '../services/upgradeRoadmap';
import { DATA_PROVIDER_DEFS } from '../services/dataProviders';
import { ModuleType } from '../types';

type Props = {
  module: ModuleType;
};

/** 新板块占位页：导航/权限已挂，展示升级路线；业务实现后续迭代 */
export const ModuleComingSoon: React.FC<Props> = ({ module }) => {
  const item = findNavItem(module);
  const section = findSectionByModule(module);
  const roadmap = MODULE_ROADMAP[module];
  const Icon = item?.icon || Construction;
  const providers = (roadmap?.providers || [])
    .map((id) => DATA_PROVIDER_DEFS.find((d) => d.id === id))
    .filter(Boolean);

  return (
    <div className="max-w-[90rem] mx-auto animate-fade-in px-1 space-y-4">
      <div className="relative overflow-hidden rounded-3xl border border-cyan-200/60 bg-white/90 shadow-signal p-8 sm:p-12">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-40 blur-3xl"
          style={{ background: section?.accent || '#22d3ee' }}
        />
        <div className="relative flex flex-col sm:flex-row gap-6 items-start">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl border shadow-sm shrink-0"
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
            <p className="text-sm font-semibold text-slate-500 leading-relaxed max-w-3xl">
              {roadmap?.summary ||
                `本模块已纳入「${section?.label || '平台'}」导航与权限体系，业务能力将在后续迭代上线。现有商机 / CRM / 邮件等模块与本地、云端数据互不影响。`}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="text-[11px] font-black text-slate-400 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg">
                {item?.sub || module}
              </span>
              <span className="text-[11px] font-black text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-lg">
                Coming Soon
              </span>
              {roadmap && (
                <span className="text-[11px] font-black text-cyan-800 bg-cyan-50 border border-cyan-100 px-2.5 py-1 rounded-lg">
                  {roadmap.phase} · {PHASE_LABEL[roadmap.phase]}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {roadmap && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 sm:p-6 shadow-sm">
            <div className="flex items-center gap-2 text-slate-800 font-black text-sm mb-3">
              <ListChecks size={16} className="text-cyan-600" /> 规划能力
            </div>
            <ul className="space-y-2">
              {roadmap.bullets.map((b) => (
                <li key={b} className="text-sm text-slate-600 font-medium flex gap-2">
                  <span className="text-cyan-500 font-black shrink-0">·</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 sm:p-6 shadow-sm space-y-4">
            {roadmap.inspiredBy && roadmap.inspiredBy.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-slate-800 font-black text-sm mb-2">
                  <Layers size={16} className="text-violet-600" /> 对标参考
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {roadmap.inspiredBy.map((x) => (
                    <span
                      key={x}
                      className="text-[11px] font-bold text-violet-800 bg-violet-50 border border-violet-100 px-2 py-1 rounded-lg"
                    >
                      {x}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {providers.length > 0 && (
              <div>
                <div className="text-slate-800 font-black text-sm mb-2">依赖数据源（后台配置）</div>
                <div className="flex flex-wrap gap-1.5">
                  {providers.map((p) => (
                    <span
                      key={p!.id}
                      className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-lg"
                    >
                      {p!.label}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 font-medium mt-2">
                  管理员可在「系统管理 → 数据接入」预填 API / 合同信息，接通后再实现业务逻辑。
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
