/**
 * 统一后台调度：夜间补全 / 队列泵 / 登录同步等在冷静期让路，分片让出主线程。
 */
import { shouldDeferHeavyWork, subscribeForeground } from './foregroundGuard';

export type BgWorkKind =
  | 'night_upgrade'
  | 'product_dig'
  | 'enrichment'
  | 'design_signal'
  | 'dm_email'
  | 'workspace_sync'
  | 'idle_catalog'
  | 'other';

type QueuedUnit = {
  id: string;
  kind: BgWorkKind;
  run: () => void | Promise<void>;
  enqueuedAt: number;
};

const queue: QueuedUnit[] = [];
let pumping = false;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

export const yieldToUi = (ms = 0): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function' && ms <= 0) {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
      return;
    }
    setTimeout(resolve, ms);
  });

/** 跑一批前/条间调用：冷静期则等待，回前台后再继续 */
export const waitUntilWorkAllowed = async (
  shouldStop?: () => boolean,
  maxWaitMs = 120_000
): Promise<boolean> => {
  const start = Date.now();
  while (shouldDeferHeavyWork()) {
    if (shouldStop?.()) return false;
    if (Date.now() - start > maxWaitMs) return false;
    await yieldToUi(280);
  }
  return !shouldStop?.();
};

const scheduleWake = (delayMs = 400) => {
  if (wakeTimer) return;
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    void pumpBgWork();
  }, delayMs);
};

export const enqueueBackgroundWork = (
  kind: BgWorkKind,
  run: () => void | Promise<void>,
  id = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
) => {
  // 同 id 不重复入队，避免夜间 tick 堆积几十个空转任务
  if (queue.some((u) => u.id === id)) {
    scheduleWake(shouldDeferHeavyWork() ? 600 : 40);
    return;
  }
  queue.push({ id, kind, run, enqueuedAt: Date.now() });
  scheduleWake(shouldDeferHeavyWork() ? 600 : 40);
};

export const pumpBgWork = async () => {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      if (shouldDeferHeavyWork()) {
        scheduleWake(500);
        break;
      }
      const unit = queue.shift();
      if (!unit) break;
      try {
        await unit.run();
      } catch (e) {
        console.warn('[bgScheduler] unit failed', unit.kind, e);
      }
      await yieldToUi(0);
    }
  } finally {
    pumping = false;
  }
};

if (typeof window !== 'undefined') {
  subscribeForeground((fg) => {
    if (fg && !shouldDeferHeavyWork() && queue.length) scheduleWake(80);
  });
}
