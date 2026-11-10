/**
 * 作业队列外置 store：避免把几千条任务放进 App useState。
 * App 重渲染一次要对 5k+ 节点 reconcile，侧栏点击会被饿死。
 * 只有订阅方（营销工具列表 / 计数徽章）会更新。
 */
import type { AutomationResult } from '../types';
import { slimAutomationQueueForUi } from './db';
import {
  isAppForeground,
  shouldDeferHeavyWork,
  subscribeForeground,
} from './foregroundGuard';

export type AutomationCounts = {
  total: number;
  pending: number;
  analyzing: number;
  failed: number;
  completed: number;
  completedWithAnalysis: number;
};

type Listener = () => void;

let tasks: AutomationResult[] = [];
/** UI 列表用瘦身副本，与 tasks 同 version */
let uiTasks: AutomationResult[] = [];
let version = 0;
let counts: AutomationCounts = {
  total: 0,
  pending: 0,
  analyzing: 0,
  failed: 0,
  completed: 0,
  completedWithAnalysis: 0,
};

const listeners = new Set<Listener>();
const countListeners = new Set<Listener>();
let emitQueued = false;
/** 前台短合并：背调跑起来时每秒几十次 commit，不能每次都逼 React 重绘大表 */
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

const flushEmit = () => {
  emitQueued = false;
  if (coalesceTimer) {
    clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
  emit();
  emitCounts();
};

const scheduleCoalescedFlush = () => {
  emitQueued = true;
  if (coalesceTimer) return;
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null;
    if (shouldDeferHeavyWork()) {
      // 冷静期内继续积压，等 foreground 订阅冲刷
      emitQueued = true;
      return;
    }
    flushEmit();
  }, 160);
};

const recomputeCounts = (list: AutomationResult[]): AutomationCounts => {
  let pending = 0;
  let analyzing = 0;
  let failed = 0;
  let completed = 0;
  let completedWithAnalysis = 0;
  for (const t of list) {
    if (t.status === 'pending') pending += 1;
    else if (t.status === 'analyzing' || t.status === 'generating_email') analyzing += 1;
    else if (t.status === 'failed') failed += 1;
    else if (t.status === 'completed') {
      completed += 1;
      if (t.analysis) completedWithAnalysis += 1;
    }
  }
  return {
    total: list.length,
    pending,
    analyzing,
    failed,
    completed,
    completedWithAnalysis,
  };
};

const emit = () => {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
};

const emitCounts = () => {
  countListeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
};

const commit = (next: AutomationResult[]) => {
  tasks = next;
  uiTasks = slimAutomationQueueForUi(next);
  version += 1;
  counts = recomputeCounts(next);
  // 后台 / 冷静期只积压；前台也做短合并，避免大表被每条任务状态拖死
  if (shouldDeferHeavyWork()) {
    emitQueued = true;
    return;
  }
  scheduleCoalescedFlush();
};

export const getAutomationQueueSnapshot = (): AutomationResult[] => tasks;

export const getAutomationQueueUiSnapshot = (): AutomationResult[] => uiTasks;

export const getAutomationCountsSnapshot = (): AutomationCounts => counts;

export const getAutomationQueueVersion = (): number => version;

export const replaceAutomationQueue = (next: AutomationResult[]) => {
  commit(Array.isArray(next) ? next : []);
};

export const updateAutomationQueue = (
  updater: (prev: AutomationResult[]) => AutomationResult[]
): AutomationResult[] => {
  const next = updater(tasks);
  commit(next);
  return next;
};

export const subscribeAutomationQueue = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const subscribeAutomationCounts = (fn: Listener): (() => void) => {
  countListeners.add(fn);
  return () => countListeners.delete(fn);
};

// 回前台且冷静结束后，冲掉积压的队列通知
if (typeof window !== 'undefined') {
  subscribeForeground((fg) => {
    if (fg && emitQueued && !shouldDeferHeavyWork()) flushEmit();
  });
}
