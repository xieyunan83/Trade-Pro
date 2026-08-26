import type { AutomationResult, DecisionMaker, User } from '../types';
import { saveAutomationTask, getAutomationQueue, deleteAutomationTask } from './db';

/** 稳定唯一 ID，避免短 random 碰撞导致 IndexedDB put 互相覆盖丢任务 */
export const newAutomationTaskId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `auto_${crypto.randomUUID()}`;
  }
  return `auto_${Date.now()}_${Math.random().toString(36).slice(2, 11)}_${Math.random()
    .toString(36)
    .slice(2, 11)}`;
};

const domainKey = (raw?: string) =>
  (raw || '')
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .trim();

/**
 * 加载任务队列并修复：
 * 1) 短 id / 重复 id → 重新分配并写回，避免 put 覆盖丢数据
 * 2) 无归属旧任务 → 认领给当前用户，避免权限过滤后「看不见」
 */
export const loadAndRepairAutomationQueue = async (
  currentUser: User
): Promise<{ tasks: AutomationResult[]; repaired: number; claimed: number }> => {
  const raw = await getAutomationQueue();
  const seen = new Set<string>();
  let repaired = 0;
  let claimed = 0;
  const next: AutomationResult[] = [];

  for (const task of raw) {
    let t: AutomationResult = { ...task };
    const id = (t.id || '').trim();
    const idTooWeak = !id || id.length < 12 || seen.has(id);
    if (idTooWeak) {
      const oldId = t.id;
      t = { ...t, id: newAutomationTaskId() };
      repaired += 1;
      try {
        await saveAutomationTask(t);
        if (oldId && oldId !== t.id) {
          await deleteAutomationTask(oldId).catch(() => undefined);
        }
      } catch (e) {
        console.warn('[automation] repair id save failed', e);
      }
    }
    seen.add(t.id);

    if (!t.ownerUsername && !t.departmentId && currentUser?.username) {
      t = {
        ...t,
        ownerUsername: currentUser.username,
        departmentId: currentUser.departmentId,
      };
      claimed += 1;
      try {
        await saveAutomationTask(t);
      } catch (e) {
        console.warn('[automation] claim ownership save failed', e);
      }
    }

    next.push(t);
  }

  next.sort((a, b) => (b.completedAt || b.createdAt || 0) - (a.completedAt || a.createdAt || 0));
  return { tasks: next, repaired, claimed };
};

/** 把决策人挖掘结果写回匹配的队列任务（内存 + IndexedDB） */
export const mergeDecisionMakersIntoAutomationTasks = async (
  tasks: AutomationResult[],
  opts: {
    domain?: string;
    companyName?: string;
    taskId?: string;
    decisionMakers: DecisionMaker[];
    searchedAt: number;
    searchHistory?: number[];
  }
): Promise<AutomationResult[]> => {
  const wantDomain = domainKey(opts.domain);
  const wantName = (opts.companyName || '').trim().toLowerCase();
  const wantTaskId = opts.taskId;

  const updated: AutomationResult[] = [];
  let changed = false;

  for (const t of tasks) {
    const tDomain = domainKey(t.website || t.analysis?.companyInfo?.website);
    const tName = (t.clientName || t.analysis?.companyInfo?.name || '').trim().toLowerCase();
    const hit =
      (wantTaskId && t.id === wantTaskId) ||
      (wantDomain && tDomain && wantDomain === tDomain) ||
      (wantName && tName && wantName === tName);

    if (!hit || !t.analysis) {
      updated.push(t);
      continue;
    }

    const nextTask: AutomationResult = {
      ...t,
      analysis: {
        ...t.analysis,
        decisionMakers: opts.decisionMakers,
        decisionMakerEmailSearchAt: opts.searchedAt,
        decisionMakerEmailSearchHistory: opts.searchHistory?.length
          ? opts.searchHistory
          : t.analysis.decisionMakerEmailSearchHistory,
      },
    };
    changed = true;
    updated.push(nextTask);
    try {
      await saveAutomationTask(nextTask);
    } catch (e) {
      console.error('[automation] persist DM result failed', e);
      try {
        const slim: AutomationResult = {
          ...nextTask,
          analysis: nextTask.analysis
            ? {
                ...nextTask.analysis,
                products: (nextTask.analysis.products || []).slice(0, 8).map((p) => ({
                  ...p,
                  imageUrl: undefined,
                })),
                similarCompanies: (nextTask.analysis.similarCompanies || []).slice(0, 12),
              }
            : nextTask.analysis,
          productImages: [],
        };
        await saveAutomationTask(slim);
      } catch (e2) {
        console.error('[automation] slim persist also failed', e2);
      }
    }
  }

  return changed ? updated : tasks;
};
