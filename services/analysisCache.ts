/**
 * 背调结果本地缓存：同域名+模式+关键词指纹命中则复用，省 Token / 加速。
 */
import type { AnalysisResult } from '../types';

const CACHE_KEY = 'trade_scout_analysis_cache_v1';
const MAX_ENTRIES = 80;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CacheEntry = {
  fingerprint: string;
  savedAt: number;
  result: AnalysisResult;
};

type CacheStore = Record<string, CacheEntry>;

const loadStore = (): CacheStore => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CacheStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const saveStore = (store: CacheStore) => {
  try {
    const entries = Object.entries(store).sort((a, b) => b[1].savedAt - a[1].savedAt);
    const trimmed = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    localStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota */
  }
};

export const buildAnalysisFingerprint = (
  domainOrName: string,
  mode: string,
  opts?: { searchKeyword?: string; searchCountry?: string }
): string => {
  const d = (domainOrName || '').trim().toLowerCase();
  const kw = (opts?.searchKeyword || '').trim().toLowerCase();
  const c = (opts?.searchCountry || '').trim().toLowerCase();
  return `${d}|${mode}|${kw}|${c}`;
};

export const getCachedAnalysis = (fingerprint: string): AnalysisResult | null => {
  const store = loadStore();
  const hit = store[fingerprint];
  if (!hit) return null;
  if (Date.now() - hit.savedAt > TTL_MS) {
    delete store[fingerprint];
    saveStore(store);
    return null;
  }
  return hit.result;
};

export const setCachedAnalysis = (fingerprint: string, result: AnalysisResult): void => {
  const store = loadStore();
  store[fingerprint] = { fingerprint, savedAt: Date.now(), result };
  saveStore(store);
};

export const clearAnalysisCache = (): void => {
  localStorage.removeItem(CACHE_KEY);
};
