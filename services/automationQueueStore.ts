/**
 * 作业队列外置 store：避免把几千条任务放进 App useState。
 * App 重渲染一次要对 5k+ 节点 reconcile，侧栏点击会被饿死。
 * 只有订阅方（营销工具列表 / 计数徽章）会更新。
 */
import type { AutomationResult } from '../types';
import { slimAutomationQueueForUi } from './db';
import { isAppForeground, subscribeForeground } from './foregroundGuard';

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

const flushEmit = () => {
  emitQueued = false;
  emit();
  emitCounts();
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
  // 后台/最小化时积压通知，回前台再刷，避免切回瞬间饿死侧栏
  if (!isAppForeground()) {
    if (!emitQueued) {
      emitQueued = true;
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          if (isAppForeground()) flushEmit();
        }, 400);
      }
    }
    return;
  }
  flushEmit();
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

// 回前台时冲掉后台积压的队列通知
if (typeof window !== 'undefined') {
  subscribeForeground((fg) => {
    if (fg && emitQueued) flushEmit();
  });
}
