import React, { memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, StopCircle, Zap } from 'lucide-react';
import type { ModuleType, User } from '../types';
import { SphereNav, type SphereNavPhase } from './SphereNav';
import type { PlatformSectionId } from '../services/platformSections';

type BatchProgress = {
  active: boolean;
  done: number;
  failed: number;
  total: number;
};

type Props = {
  currentUser: User;
  activeModule: ModuleType;
  analysisData: unknown;
  historyOpen: boolean;
  sphereNavPhase: SphereNavPhase;
  dockWidthClass: string;
  mobileMenuOpen: boolean;
  adminInWorkspace: boolean;
  isAutomating: boolean;
  batchProgress: BatchProgress;
  productDigActive: number;
  onPhaseChange: (phase: SphereNavPhase) => void;
  onSectionChange: (sectionId: PlatformSectionId | null) => void;
  onSelectModule: (m: ModuleType) => void;
  onOpenRecords: () => void;
  onOpenTeamManage?: () => void;
  onLogout: () => void;
  onStopAutomation: () => void;
  onExitAdminWorkspace?: () => void;
  onCloseMobileMenu: () => void;
};

/**
 * 侧栏坞：memo + portal 到 body，减少被主区大数据 reconcile 连带拖死的概率。
 * 真正根治仍依赖：App 根不要因作业队列/冷却每秒 setState。
 */
export const AppNavDock = memo(function AppNavDock({
  currentUser,
  activeModule,
  analysisData,
  historyOpen,
  sphereNavPhase,
  dockWidthClass,
  mobileMenuOpen,
  adminInWorkspace,
  isAutomating,
  batchProgress,
  productDigActive,
  onPhaseChange,
  onSectionChange,
  onSelectModule,
  onOpenRecords,
  onOpenTeamManage,
  onLogout,
  onStopAutomation,
  onExitAdminWorkspace,
  onCloseMobileMenu,
}: Props) {
  const handleSelect = useCallback(
    (m: ModuleType) => {
      onSelectModule(m);
      onCloseMobileMenu();
    },
    [onSelectModule, onCloseMobileMenu]
  );

  const node = (
    <aside
        className={`tp-sidebar tp-sphere-rail z-[9999] flex-col ${
        mobileMenuOpen ? 'fixed inset-y-0 left-0 z-[9999] flex translate-x-0' : 'hidden md:flex'
      } ${dockWidthClass}`}
      aria-label="平台导航坞"
      data-tp-nav-dock="1"
    >
      <div className="tp-dock-brand flex items-center justify-center py-2.5 border-b border-cyan-400/15 shrink-0">
        <div
          className="tp-brand-mark p-2 rounded-xl text-white"
          title={`外贸智慧协同 · ${currentUser.username}`}
        >
          <Zap size={16} />
        </div>
      </div>

      {(isAutomating || batchProgress.active || productDigActive > 0) &&
        sphereNavPhase === 'submenu' && (
          <div className="mx-1.5 mt-2 p-2 bg-slate-950/50 rounded-xl border border-cyan-400/20 text-slate-100 space-y-2 backdrop-blur-md">
            {(isAutomating || batchProgress.active) && (
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[9px] font-bold text-emerald-300 flex items-center gap-1">
                    <Loader2 className="animate-spin" size={9} /> 背调
                  </span>
                </div>
                {(() => {
                  const done = batchProgress.done;
                  const failed = batchProgress.failed;
                  const total = batchProgress.total || Math.max(done + failed, 1);
                  const pct = total ? Math.round(((done + failed) / total) * 100) : 0;
                  return (
                    <div className="h-1 rounded-full bg-slate-700 overflow-hidden">
                      <div className="h-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  );
                })()}
              </div>
            )}
            <button
              type="button"
              onClick={onStopAutomation}
              className="w-full bg-rose-600/90 hover:bg-rose-600 text-white text-[9px] font-bold py-1.5 rounded-lg flex items-center justify-center gap-1"
            >
              <StopCircle size={10} /> 停止
            </button>
          </div>
        )}

      <div className="flex-1 min-h-0 flex flex-col">
        <SphereNav
          currentUser={currentUser}
          activeModule={activeModule}
          analysisData={analysisData}
          historyOpen={historyOpen}
          onPhaseChange={onPhaseChange}
          onSectionChange={onSectionChange}
          onSelectModule={handleSelect}
          onOpenRecords={onOpenRecords}
          onOpenTeamManage={
            currentUser.role === 'manager' && onOpenTeamManage
              ? () => {
                  onOpenTeamManage();
                  onCloseMobileMenu();
                }
              : undefined
          }
          onLogout={onLogout}
        />
        {currentUser.role === 'admin' && adminInWorkspace && onExitAdminWorkspace && (
          <div className="px-1.5 pb-2">
            <button
              type="button"
              onClick={onExitAdminWorkspace}
              className="w-full text-[9px] font-black text-cyan-200/90 bg-cyan-500/10 border border-cyan-400/20 rounded-lg py-1.5 hover:bg-cyan-500/20"
            >
              返回管理后台
            </button>
          </div>
        )}
      </div>
    </aside>
  );

  if (typeof document === 'undefined') return node;
  return createPortal(node, document.body);
});
