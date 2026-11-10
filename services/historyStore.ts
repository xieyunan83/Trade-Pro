/**
 * 背调历史外置 store：完成后写这里，禁止 App setHistory 整树重绘。
 */
import type { HistoryItem } from '../types';
import { deleteHistoryItem, saveHistory } from './db';
import {
  shouldDeferHeavyWork,
  subscribeForeground,
} from './foregroundGuard';
import { isSupabaseConfigured, saveInvestigationHistory } from './supabase';

type Listener = () => void;

let items: HistoryItem[] = [];
let version = 0;
const listeners = new Set<Listener>();
let emitQueued = false;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let persistChain: Promise<void> = Promise.resolve();

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
  }, 200);
};

const commit = (next: HistoryItem[]) => {
  items = Array.isArray(next) ? next : [];
  version += 1;
  if (shouldDeferHeavyWork()) {
    emitQueued = true;
    return;
  }
  scheduleCoalescedFlush();
};

export const getHistorySnapshot = (): HistoryItem[] => items;

export const getHistoryVersion = (): number => version;

export const replaceHistory = (next: HistoryItem[]) => {
  commit(next);
};

export const updateHistory = (
  updater: (prev: HistoryItem[]) => HistoryItem[]
): HistoryItem[] => {
  const next = updater(items);
  commit(next);
  return next;
};

export const upsertHistoryItem = (item: HistoryItem): HistoryItem[] =>
  updateHistory((prev) => {
    const idx = prev.findIndex((h) => h.id === item.id);
    if (idx < 0) return [item, ...prev];
    const copy = prev.slice();
    copy[idx] = item;
    return copy;
  });

export const removeHistoryItem = (id: string): HistoryItem[] =>
  updateHistory((prev) => prev.filter((h) => h.id !== id));

export const removeHistoryItems = (ids: Set<string> | string[]): HistoryItem[] => {
  const set = ids instanceof Set ? ids : new Set(ids);
  return updateHistory((prev) => prev.filter((h) => !set.has(h.id)));
};

/** 串行落盘：本机 IDB + 可选云端，不经 React */
export const persistHistoryItemToDisk = (item: HistoryItem): Promise<void> => {
  persistChain = persistChain
    .then(async () => {
      await saveHistory(item);
      if (isSupabaseConfigured()) {
        try {
          await saveInvestigationHistory(item);
        } catch (e) {
          console.error('Supabase history save failed', e);
        }
      }
    })
    .catch((e) => {
      console.error('[historyStore] persist failed', e);
    });
  return persistChain;
};

export const upsertAndPersistHistoryItem = async (item: HistoryItem): Promise<void> => {
  upsertHistoryItem(item);
  await persistHistoryItemToDisk(item);
};

export const deleteHistoryItemEverywhere = async (id: string): Promise<void> => {
  removeHistoryItem(id);
  try {
    await deleteHistoryItem(id);
  } catch (e) {
    console.warn('[historyStore] local delete failed', id, e);
  }
};

export const subscribeHistory = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const flushHistoryNotify = () => flushEmit();

if (typeof window !== 'undefined') {
  subscribeForeground((fg) => {
    if (fg && emitQueued && !shouldDeferHeavyWork()) flushEmit();
  });
}
