import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, History, LogOut, Users, X } from 'lucide-react';
import { ModuleType, User } from '../types';
import { canAccessModule, hasPermission } from '../services/permissions';
import {
  PLATFORM_SECTIONS,
  type PlatformSection,
  type PlatformSectionId,
  findSectionByModule,
} from '../services/platformSections';
import { ALWAYS_ACTIVE_MODULES } from '../services/moduleNav';

type NavPhase = 'start' | 'sections' | 'submenu';

type Props = {
  currentUser: User;
  activeModule: ModuleType;
  analysisData: unknown;
  onSelectModule: (m: ModuleType) => void;
  onOpenRecords: () => void;
  onOpenTeamManage?: () => void;
  onLogout: () => void;
  historyOpen: boolean;
  /** 导航展开态变化（侧栏变宽挤开主区，不遮挡内容） */
  onExpandedChange?: (expanded: boolean) => void;
};

export const SphereNav: React.FC<Props> = ({
  currentUser,
  activeModule,
  analysisData,
  onSelectModule,
  onOpenRecords,
  onOpenTeamManage,
  onLogout,
  historyOpen,
  onExpandedChange,
}) => {
  const [phase, setPhase] = useState<NavPhase>('start');
  const [sectionId, setSectionId] = useState<PlatformSectionId | null>(null);

  useEffect(() => {
    onExpandedChange?.(phase !== 'start');
  }, [phase, onExpandedChange]);

  const visibleSections = useMemo(() => {
    return PLATFORM_SECTIONS.map((sec) => ({
      ...sec,
      items: sec.items.filter((it) => canAccessModule(currentUser, it.id)),
    })).filter((sec) => sec.items.length > 0);
  }, [currentUser]);

  const activeSection = useMemo(
    () => visibleSections.find((s) => s.id === sectionId) || null,
    [visibleSections, sectionId]
  );

  useEffect(() => {
    const sec = findSectionByModule(activeModule);
    if (sec && visibleSections.some((s) => s.id === sec.id)) {
      setSectionId(sec.id);
    }
  }, [activeModule, visibleSections]);

  const openStart = () => {
    setPhase('sections');
    setSectionId(null);
  };

  const pickSection = (sec: PlatformSection) => {
    setSectionId(sec.id);
    setPhase('submenu');
  };

  const pickModule = (mod: ModuleType) => {
    const needsAnalysis = !ALWAYS_ACTIVE_MODULES.includes(mod) && !analysisData;
    if (needsAnalysis) {
      alert('请先完成客户搜索或背调，再进入该模块。');
      return;
    }
    onSelectModule(mod);
  };

  const backToSections = () => setPhase('sections');
  const collapseToStart = () => {
    setPhase('start');
    setSectionId(null);
  };

  const SecIcon = activeSection?.icon;

  return (
    <div className="tp-sphere-nav flex flex-col h-full min-h-0">
      <div className="px-3 pt-5 pb-3 flex flex-col items-center gap-3">
        {phase === 'start' ? (
          <button
            type="button"
            onClick={openStart}
            className="tp-sphere tp-sphere-start group"
            title="开始 · 展开五大板块"
            aria-label="开始"
          >
            <span className="tp-sphere-core">
              <span className="tp-sphere-label">开始</span>
            </span>
            <span className="tp-sphere-ring" aria-hidden />
            <span className="tp-sphere-ring tp-sphere-ring-delay" aria-hidden />
          </button>
        ) : (
          <div className="w-full flex items-center justify-between gap-2 px-1">
            <button
              type="button"
              onClick={phase === 'submenu' ? backToSections : collapseToStart}
              className="tp-sphere-chrome inline-flex items-center gap-1 text-[11px] font-black px-2 py-1.5 rounded-lg"
            >
              <ChevronLeft size={14} />
              {phase === 'submenu' ? '板块' : '收起'}
            </button>
            <button
              type="button"
              onClick={collapseToStart}
              className="tp-sphere-chrome p-1.5 rounded-lg"
              title="回到开始"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {phase !== 'start' && (
          <div className="text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-700/70">
              Trade Pro
            </div>
            <div className="text-xs font-bold text-slate-700 mt-0.5">
              {phase === 'sections' ? '选择板块' : activeSection?.label || '子菜单'}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-2 min-h-0">
        {phase === 'sections' && (
          <div className="tp-sphere-orbit relative py-4">
            <div className="tp-sphere-orbit-ring" aria-hidden />
            <div className="grid grid-cols-1 gap-3 place-items-center relative z-[1]">
              {visibleSections.map((sec, idx) => {
                const Icon = sec.icon;
                const isHot = findSectionByModule(activeModule)?.id === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => pickSection(sec)}
                    className={`tp-sphere tp-sphere-section ${isHot ? 'is-hot' : ''}`}
                    style={
                      {
                        '--sphere-accent': sec.accent,
                        animationDelay: `${idx * 0.08}s`,
                      } as React.CSSProperties
                    }
                    title={sec.label}
                  >
                    <span className="tp-sphere-core tp-sphere-core-sm">
                      <Icon size={18} className="mb-0.5 opacity-90" />
                      <span className="tp-sphere-label-sm">{sec.label}</span>
                    </span>
                    <span className="tp-sphere-ring tp-sphere-ring-sm" aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {phase === 'submenu' && activeSection && SecIcon && (
          <div className="space-y-1.5 animate-fade-in py-2">
            <div
              className="mx-auto mb-3 tp-sphere tp-sphere-section is-hot pointer-events-none"
              style={{ '--sphere-accent': activeSection.accent } as React.CSSProperties}
            >
              <span className="tp-sphere-core tp-sphere-core-sm">
                <SecIcon size={16} className="mb-0.5" />
                <span className="tp-sphere-label-sm">{activeSection.label}</span>
              </span>
            </div>
            {activeSection.items.map((item) => {
              const Icon = item.icon;
              const active = activeModule === item.id;
              const locked = !ALWAYS_ACTIVE_MODULES.includes(item.id) && !analysisData;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={locked}
                  onClick={() => pickModule(item.id)}
                  className={`tp-sphere-leaf w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all disabled:opacity-35 ${
                    active ? 'is-active' : ''
                  }`}
                  style={
                    active
                      ? ({ borderColor: `${activeSection.accent}88` } as React.CSSProperties)
                      : undefined
                  }
                >
                  <span
                    className="tp-sphere-mini shrink-0"
                    style={{ '--sphere-accent': activeSection.accent } as React.CSSProperties}
                  >
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="tp-leaf-title block text-[12px] font-bold truncate">
                      {item.label}
                    </span>
                    <span className="tp-leaf-sub block text-[9px] font-semibold uppercase tracking-wider">
                      {item.sub}
                      {item.comingSoon ? ' · Soon' : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {phase === 'start' && (
          <div className="px-2 pt-6 text-center space-y-2">
            <p className="tp-sphere-nav-hint text-[10px] font-bold leading-relaxed">
              点击「开始」展开
              <br />
              商机 · 产品 · 宣发 · 联动 · 生态
            </p>
            {findSectionByModule(activeModule) && (
              <button
                type="button"
                onClick={() => {
                  const sec = findSectionByModule(activeModule);
                  if (!sec) return;
                  setSectionId(sec.id);
                  setPhase('submenu');
                }}
                className="tp-sphere-nav-link text-[10px] font-black underline-offset-2 hover:underline"
              >
                当前：{findNavLabel(activeModule)}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-cyan-900/5 space-y-1.5 shrink-0">
        {currentUser.role === 'manager' && onOpenTeamManage && (
          <button
            type="button"
            onClick={onOpenTeamManage}
            className="tp-sphere-foot-btn w-full flex items-center justify-center gap-2 px-2 py-2.5 rounded-xl text-[11px] font-bold"
          >
            <Users size={15} className="text-cyan-600" />
            <span className={phase === 'start' ? 'sr-only' : ''}>系统管理</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (!hasPermission(currentUser, 'feature.records_center')) {
              alert('你没有「记录中心」权限，请联系管理员或部门主管开通。');
              return;
            }
            onOpenRecords();
          }}
          className={`tp-sphere-foot-btn w-full flex items-center justify-center gap-2 px-2 py-2.5 rounded-xl text-[11px] font-bold ${
            historyOpen ? 'is-on' : ''
          }`}
        >
          <History size={15} className="text-cyan-600" />
          <span className={phase === 'start' ? 'sr-only' : ''}>记录中心</span>
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="tp-sphere-foot-btn w-full flex items-center justify-center gap-2 px-2 py-2.5 rounded-xl text-[11px] font-bold text-rose-600 hover:bg-rose-50"
        >
          <LogOut size={15} />
          <span className={phase === 'start' ? 'sr-only' : ''}>退出</span>
        </button>
      </div>
    </div>
  );
};

const findNavLabel = (mod: ModuleType): string => {
  for (const s of PLATFORM_SECTIONS) {
    const hit = s.items.find((i) => i.id === mod);
    if (hit) return `${s.label} / ${hit.label}`;
  }
  return String(mod);
};
