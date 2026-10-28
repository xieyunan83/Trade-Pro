import React, { useLayoutEffect, useSyncExternalStore } from 'react';
import {
  getKeepAliveSnapshot,
  isKeepAliveMounted,
  subscribeKeepAlive,
  touchKeepAlive,
} from '../services/moduleKeepAlive';

type Props = {
  /** 当前激活的模块 id */
  activeId: string;
  /** 本面板对应的模块 id */
  id: string;
  /** 全局最多常驻几个面板（超出按 LRU 卸载） */
  maxAlive?: number;
  children: React.ReactNode;
};

/**
 * 模块切换保活：已访问过的面板用 display:none 隐藏，避免反复整页挂载卡顿。
 * 多面板共享同一 LRU（见 moduleKeepAlive）。
 */
export const ModulePane: React.FC<Props> = ({
  activeId,
  id,
  maxAlive = 8,
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
      className={isActive ? 'contents' : undefined}
      style={isActive ? undefined : { display: 'none' }}
      aria-hidden={!isActive}
      data-module-pane={id}
      data-active={isActive ? '1' : '0'}
    >
      {children}
    </div>
  );
};
