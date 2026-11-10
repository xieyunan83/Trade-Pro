import type { AutomationResult, DecisionMaker, User } from '../types';
import { saveAutomationTask, getAutomationQueue, deleteAutomationTask } from './db';
import { canBrowseAllDepartments } from './permissions';

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
  /** 登录时禁止逐条 await 写盘（几千条会卡死侧栏）；先改内存，空闲再落盘 */
  const persistLater: AutomationResult[] = [];
  const deleteLater: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const task = raw[i];
    let t: AutomationResult = { ...task };
    const id = (t.id || '').trim();
    const idTooWeak = !id || id.length < 12 || seen.has(id);
    if (idTooWeak) {
      const oldId = t.id;
      t = { ...t, id: newAutomationTaskId() };
      repaired += 1;
      persistLater.push(t);
      if (oldId && oldId !== t.id) deleteLater.push(oldId);
    }
    seen.add(t.id);

    // 无归属旧任务：员工认领后才能看见；admin/总管能看无归属，禁止认领以免盖掉同事归属并污染云端
    if (
      !t.ownerUsername &&
      !t.departmentId &&
      currentUser?.username &&
      !canBrowseAllDepartments(currentUser)
    ) {
      t = {
        ...t,
        ownerUsername: currentUser.username,
        departmentId: currentUser.departmentId,
      };
      claimed += 1;
      persistLater.push(t);
    }

    // 页面刷新后残留的 analyzing 视为可继续执行
    if (t.status === 'analyzing') {
      t = { ...t, status: 'pending' };
      repaired += 1;
      persistLater.push(t);
    }

    next.push(t);
    // 每 400 条让出主线程，避免登录扫库时菜单点不动
    if (i > 0 && i % 400 === 0) {
      await new Promise<void>((r) => window.setTimeout(r, 0));
    }
  }

  next.sort((a, b) => (b.completedAt || b.createdAt || 0) - (a.completedAt || a.createdAt || 0));

  if (persistLater.length || deleteLater.length) {
    window.setTimeout(() => {
      void (async () => {
        for (const id of deleteLater) {
          try {
            await deleteAutomationTask(id);
          } catch {
            /* ignore */
          }
        }
        for (let i = 0; i < persistLater.length; i++) {
          try {
            await saveAutomationTask(persistLater[i], { skipCloud: true });
          } catch (e) {
            console.warn('[automation] deferred repair save failed', e);
          }
          if (i > 0 && i % 50 === 0) {
            await new Promise<void>((r) => window.setTimeout(r, 0));
          }
        }
      })();
    }, 12_000);
  }

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
