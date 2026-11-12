/**
 * 跨 ModulePane 共享的 LRU 保活：切换模块时保留最近 N 个已访问面板，避免反复卸载/挂载。
 * 预算过小（如 2）会像「网站切页」；默认提高以接近本机软件多标签体感。
 */
type Listener = () => void;

/** 全局同时保活面板数（高频模块切回应秒开） */
export const MODULE_KEEP_ALIVE_BUDGET = 10;

let order: string[] = [];
const alive = new Set<string>();
const listeners = new Set<Listener>();

const emit = () => {
  listeners.forEach((l) => l());
};

export const touchKeepAlive = (id: string, maxAlive = MODULE_KEEP_ALIVE_BUDGET): void => {
  const without = order.filter((x) => x !== id);
  let next = [...without, id];
  const drop: string[] = [];
  if (next.length > maxAlive) {
    drop.push(...next.slice(0, next.length - maxAlive));
    next = next.slice(-maxAlive);
  }
  order = next;
  drop.forEach((d) => {
    if (d !== id) alive.delete(d);
  });
  alive.add(id);
  emit();
};

export const isKeepAliveMounted = (id: string): boolean => alive.has(id);

export const subscribeKeepAlive = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** 供 React 订阅（useSyncExternalStore） */
export const getKeepAliveSnapshot = (): string => order.join('|');
