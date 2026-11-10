/**
 * CRM 外置 store：后台补全/云同步不得 setState App。
 * 通知合并 + 冷静期积压，与 automationQueueStore 同模式。
 */
import type { Client, Department, User } from '../types';
import {
  shouldDeferHeavyWork,
  subscribeForeground,
} from './foregroundGuard';
import { mergeSaveCrmClients, saveAllCrmClients } from '../utils/workspaceScope';

type Listener = () => void;

let clients: Client[] = [];
let version = 0;
const listeners = new Set<Listener>();
let emitQueued = false;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let cloudTimer: ReturnType<typeof setTimeout> | null = null;

type PersistCtx = {
  getViewer: () => User | null;
  getUsers: () => User[];
  getDepartments: () => Department[];
  isReady: () => boolean;
  isGitHubConnected: () => boolean;
};

let persistCtx: PersistCtx | null = null;

const emit = () => {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
};

const flushEmit = () => {
  emitQueued = false;
  if (coalesceTimer) {
    clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
  emit();
};

const scheduleCoalescedFlush = () => {
  emitQueued = true;
  if (coalesceTimer) return;
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null;
    if (shouldDeferHeavyWork()) {
      emitQueued = true;
      return;
    }
    flushEmit();
  }, 220);
};

/** 最近一次 mergeSave 后的全库快照，供 GitHub 整表备份（禁止用可见切片覆盖全库） */
let lastMergedAll: Client[] | null = null;

const scheduleIdlePersist = () => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const run = () => {
      if (!persistCtx?.isReady()) return;
      const viewer = persistCtx.getViewer();
      if (!viewer) {
        saveAllCrmClients(clients);
        lastMergedAll = clients;
        return;
      }
      // 与旧 App effect 一致：可见列表 merge 进全库，他人部门数据保留
      lastMergedAll = mergeSaveCrmClients(
        viewer,
        clients,
        persistCtx.getUsers(),
        persistCtx.getDepartments()
      );
    };
    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    }).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(run, { timeout: 2500 });
    } else {
      run();
    }
  }, 600);

  if (cloudTimer) clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    cloudTimer = null;
    if (!persistCtx?.isReady()) return;
    if (clients.length > 800) return;
    void (async () => {
      try {
        const { isSupabaseConfigured, syncCrmClients } = await import('./supabase');
        // 与旧逻辑一致：Supabase 按可见集 upsert（不删他人）
        if (isSupabaseConfigured() && clients.length > 0) {
          await syncCrmClients(clients);
        }
      } catch (e) {
        console.error('Supabase CRM sync failed', e);
      }
      try {
        const forGh = lastMergedAll && lastMergedAll.length ? lastMergedAll : clients;
        if (
          persistCtx?.isGitHubConnected() &&
          forGh.length > 0 &&
          forGh.length <= 800
        ) {
          const { saveCRMToCloud } = await import('./githubService');
          // GitHub 必须写全库合并结果，避免把其它部门冲掉
          await saveCRMToCloud(forGh);
        }
      } catch (e) {
        console.error('Auto CRM GitHub sync failed', e);
      }
    })();
  }, 16_000);
};

const commit = (next: Client[], opts?: { persist?: boolean }) => {
  clients = Array.isArray(next) ? next : [];
  version += 1;
  if (opts?.persist !== false) scheduleIdlePersist();
  if (shouldDeferHeavyWork()) {
    emitQueued = true;
    return;
  }
  scheduleCoalescedFlush();
};

export const configureCrmStorePersist = (ctx: PersistCtx) => {
  persistCtx = ctx;
};

export const getCrmClientsSnapshot = (): Client[] => clients;

export const getCrmClientsVersion = (): number => version;

export const replaceCrmClients = (next: Client[], opts?: { persist?: boolean }) => {
  commit(next, opts);
};

export const updateCrmClients = (
  updater: (prev: Client[]) => Client[],
  opts?: { persist?: boolean }
): Client[] => {
  const next = updater(clients);
  commit(next, opts);
  return next;
};

export const patchCrmClient = (client: Client, opts?: { persist?: boolean }) => {
  updateCrmClients((prev) => {
    const idx = prev.findIndex((c) => c.id === client.id);
    if (idx < 0) return [...prev, client];
    const copy = prev.slice();
    copy[idx] = client;
    return copy;
  }, opts);
};

export const applyCrmClientPatches = (
  patches: Map<string, Client> | Record<string, Client>,
  opts?: { persist?: boolean }
) => {
  const map = patches instanceof Map ? patches : new Map(Object.entries(patches));
  if (!map.size) return;
  updateCrmClients((prev) => {
    let changed = false;
    const next = prev.map((c) => {
      const p = map.get(c.id);
      if (!p) return c;
      changed = true;
      return p;
    });
    return changed ? next : prev;
  }, opts);
};

export const subscribeCrmClients = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** 强制立刻通知订阅方（登录首屏等） */
export const flushCrmClientsNotify = () => flushEmit();

if (typeof window !== 'undefined') {
  subscribeForeground((fg) => {
    if (fg && emitQueued && !shouldDeferHeavyWork()) flushEmit();
  });
}
