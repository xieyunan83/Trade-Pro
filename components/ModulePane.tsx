import React, { useEffect, useState } from 'react';

type Props = {
  /** 当前激活的模块 id */
  activeId: string;
  /** 本面板对应的模块 id */
  id: string;
  /** 最多常驻几个面板（超出按 LRU 卸载） */
  maxAlive?: number;
  children: React.ReactNode;
};

/**
 * 模块切换保活：已访问过的面板用 display:none 隐藏，避免反复整页挂载卡顿。
 * 仅用于较重、状态本地化的创作类模块。
 */
export const ModulePane: React.FC<Props> = ({
  activeId,
  id,
  maxAlive = 4,
  children,
}) => {
  const isActive = activeId === id;
  const [alive, setAlive] = useState(() => new Set<string>(isActive ? [id] : []));
  const [order, setOrder] = useState<string[]>(isActive ? [id] : []);

  // 当前激活的面板：同步纳入保活，避免首帧空白
  const mounted = isActive || alive.has(id);

  useEffect(() => {
    if (!isActive) return;
    setAlive((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setOrder((prev) => {
      const without = prev.filter((x) => x !== id);
      let next = [...without, id];
      if (next.length > maxAlive) {
        const drop = next.slice(0, next.length - maxAlive);
        next = next.slice(-maxAlive);
        setAlive((a) => {
          const trimmed = new Set(a);
          drop.forEach((d) => {
            if (d !== id) trimmed.delete(d);
          });
          // 保证当前仍在
          trimmed.add(id);
          return trimmed;
        });
      }
      return next;
    });
  }, [isActive, id, maxAlive]);

  if (!mounted) return null;

  return (
    <div
      className={isActive ? 'contents' : undefined}
      style={isActive ? undefined : { display: 'none' }}
      aria-hidden={!isActive}
    >
      {children}
    </div>
  );
};
