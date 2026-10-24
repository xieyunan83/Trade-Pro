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

export type SphereNavPhase = 'start' | 'sections' | 'submenu';

type Props = {
  currentUser: User;
  activeModule: ModuleType;
  analysisData: unknown;
  onSelectModule: (m: ModuleType) => void;
  onOpenRecords: () => void;
  onOpenTeamManage?: () => void;
  onLogout: () => void;
  historyOpen: boolean;
  /** 相位变化：用于固定坞宽度与主区让位 */
  onPhaseChange?: (phase: SphereNavPhase) => void;
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
  onPhaseChange,
}) => {
  const [phase, setPhase] = useState<SphereNavPhase>('start');
  const [sectionId, setSectionId] = useState<PlatformSectionId | null>(null);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

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
    <div className={`tp-sphere-nav tp-sphere-nav--${phase} flex h-full min-h-0 w-full`}>
      {/* 左轨：始终窄条，球体特效 */}
      <div className="tp-sphere-core-rail flex flex-col items-center h-full min-h-0 w-[4.25rem] shrink-0">
        <div className="pt-3 pb-2 flex flex-col items-center gap-2">
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
            <button
              type="button"
              onClick={phase === 'submenu' ? backToSections : collapseToStart}
              className="tp-sphere-chrome p-1.5 rounded-lg"
              title={phase === 'submenu' ? '返回板块' : '收起'}
            >
              {phase === 'submenu' ? <ChevronLeft size={16} /> : <X size={16} />}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar w-full px-1 pb-2 min-h-0">
          {phase === 'start' && (
            <div className="px-0.5 pt-4 text-center">
              <p className="tp-sphere-nav-hint text-[8px] font-bold leading-tight tracking-wide">
                点「开始」
              </p>
            </div>
          )}

          {(phase === 'sections' || phase === 'submenu') && (
            <div className="tp-sphere-orbit relative py-2">
              <div className="tp-sphere-orbit-ring" aria-hidden />
              <div className="flex flex-col items-center gap-2.5 relative z-[1]">
                {visibleSections.map((sec, idx) => {
                  const Icon = sec.icon;
                  const isHot =
                    sectionId === sec.id || findSectionByModule(activeModule)?.id === sec.id;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => pickSection(sec)}
                      className={`tp-sphere tp-sphere-section ${isHot ? 'is-hot' : ''}`}
                      style={
                        {
                          '--sphere-accent': sec.accent,
                          animationDelay: `${idx * 0.06}s`,
                        } as React.CSSProperties
                      }
                      title={sec.label}
                    >
                      <span className="tp-sphere-core tp-sphere-core-sm">
                        <Icon size={15} className="mb-0.5 opacity-95" />
                        <span className="tp-sphere-label-sm">{sec.label}</span>
                      </span>
                      <span className="tp-sphere-ring tp-sphere-ring-sm" aria-hidden />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="tp-sphere-foot py-2 space-y-1 shrink-0 w-full px-1.5 border-t border-cyan-400/10">
          {currentUser.role === 'manager' && onOpenTeamManage && (
            <button
              type="button"
              onClick={onOpenTeamManage}
              className="tp-sphere-foot-btn w-full flex items-center justify-center py-2 rounded-xl"
              title="系统管理"
            >
              <Users size={15} className="text-cyan-300" />
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
            className={`tp-sphere-foot-btn w-full flex items-center justify-center py-2 rounded-xl ${
              historyOpen ? 'is-on' : ''
            }`}
            title="记录中心"
          >
            <History size={15} className="text-cyan-300" />
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="tp-sphere-foot-btn w-full flex items-center justify-center py-2 rounded-xl text-rose-300"
            title="退出"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {/* 子菜单侧挂板：仅 submenu 出现，宽度紧凑，挤开主区而非遮盖 */}
      {phase === 'submenu' && activeSection && SecIcon && (
        <div className="tp-sphere-flyout flex flex-col min-h-0 min-w-0 flex-1 animate-fade-in">
          <div className="px-2.5 pt-3 pb-2 border-b border-cyan-400/10">
            <div className="flex items-center gap-2">
              <span
                className="tp-sphere-mini shrink-0"
                style={{ '--sphere-accent': activeSection.accent } as React.CSSProperties}
              >
                <SecIcon size={13} />
              </span>
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300/80">
                  {activeSection.sub}
                </div>
                <div className="text-sm font-extrabold text-slate-50 truncate">
                  {activeSection.label}
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar px-1.5 py-2 space-y-1 min-h-0">
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
                  className={`tp-sphere-leaf w-full flex items-center gap-2 px-2 py-2 rounded-xl text-left transition-all disabled:opacity-35 ${
                    active ? 'is-active' : ''
                  }`}
                >
                  <span
                    className="tp-sphere-mini shrink-0 !w-7 !h-7"
                    style={{ '--sphere-accent': activeSection.accent } as React.CSSProperties}
                  >
                    <Icon size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="tp-leaf-title block text-[11px] font-bold truncate leading-tight">
                      {item.label}
                    </span>
                    <span className="tp-leaf-sub block text-[8px] font-semibold uppercase tracking-wider mt-0.5">
                      {item.comingSoon
                        ? 'Soon'
                        : (
                            [
                              ModuleType.BUYER_LIBRARY,
                              ModuleType.CUSTOMS_INTEL,
                              ModuleType.PRODUCT_CATALOG,
                              ModuleType.PRODUCT_QUOTE,
                              ModuleType.PRODUCT_DESIGN_2D,
                            ] as ModuleType[]
                          ).includes(item.id)
                        ? 'NEW'
                        : item.sub}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
