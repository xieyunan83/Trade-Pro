import React, { Suspense, useLayoutEffect, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import {
  getKeepAliveSnapshot,
  isKeepAliveMounted,
  subscribeKeepAlive,
  touchKeepAlive,
} from '../services/moduleKeepAlive';
import { ErrorBoundary } from './ErrorBoundary';

type Props = {
  /** 当前激活的模块 id */
  activeId: string;
  /** 本面板对应的模块 id */
  id: string;
  /** 全局最多常驻几个面板（超出按 LRU 卸载） */
  maxAlive?: number;
  /** ErrorBoundary / 加载提示用 */
  label?: string;
  /** Suspense fallback 文案 */
  loadingText?: string;
  children: React.ReactNode;
};

/**
 * 模块切换保活：已访问过的面板用 display:none 隐藏，避免反复整页挂载卡顿。
 * 每个面板自带 Suspense：某个懒加载 chunk 卡住时，只转本面板，不再拖死整页「片刻…」。
 * 激活态必须用 block + w-full（不要用 display:contents，Electron/宽屏下会断掉宽度继承，右侧大片留白）。
 */
export const ModulePane: React.FC<Props> = ({
  activeId,
  id,
  maxAlive = 8,
  label,
  loadingText = '片刻…',
  children,
}) => {
  const isActive = activeId === id;
  useSyncExternalStore(subscribeKeepAlive, getKeepAliveSnapshot, getKeepAliveSnapshot);

  useLayoutEffect(() => {
    if (!isActive) return;
    touchKeepAlive(id, maxAlive);
  }, [isActive, id, maxAlive]);

  // 当前激活：立刻挂载；其它：仅在 LRU 内保留
  if (!isActive && !isKeepAliveMounted(id)) return null;

  return (
    <div
      className={isActive ? 'tp-module-pane is-active w-full max-w-none min-w-0' : 'tp-module-pane'}
      style={isActive ? { display: 'block', width: '100%' } : { display: 'none' }}
      aria-hidden={!isActive}
      data-module-pane={id}
      data-active={isActive ? '1' : '0'}
    >
      <ErrorBoundary label={label || id}>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
              <Loader2 className="animate-spin text-cyan-600" size={20} />
              <span className="text-xs font-bold">{loadingText}</span>
            </div>
          }
        >
          {children}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
};
