/**
 * 部门级 API Key：由主管在「系统管理」中配置，本部门用户调用时优先于全局/环境 Key。
 */
import { isSupabaseConfigured, getApiConfig, saveApiConfig } from './supabase';

const STORE_KEY = 'trade_scout_dept_api_keys_v1';

export type DeptKeyProvider = 'qwen' | 'tavily' | 'anymailfinder';

export type DeptProviderKeys = {
  keys: string[];
  baseUrl?: string;
  modelId?: string;
  updatedAt?: number;
  updatedBy?: string;
};

export type DeptApiKeysBundle = Partial<Record<DeptKeyProvider, DeptProviderKeys>>;

type StoreShape = Record<string, DeptApiKeysBundle>;

export type KeyResolutionContext = {
  username?: string;
  role?: string;
  departmentId?: string;
};

let resolutionCtx: KeyResolutionContext = {};

export const setKeyResolutionContext = (ctx: KeyResolutionContext) => {
  resolutionCtx = {
    username: ctx.username?.trim(),
    role: ctx.role,
    departmentId: ctx.departmentId?.trim() || undefined,
  };
};

export const getKeyResolutionContext = (): KeyResolutionContext => ({ ...resolutionCtx });

const normalizeApiKey = (key: string): string =>
  (key || '').replace(/^Bearer\s+/i, '').replace(/\s+/g, '').trim();

const uniqueKeys = (keys: string[]): string[] => [
  ...new Set(keys.map(normalizeApiKey).filter(Boolean)),
];

const readStore = (): StoreShape => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoreShape;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeStore = (store: StoreShape) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
};

export const getDeptApiKeysBundle = (departmentId: string | undefined): DeptApiKeysBundle => {
  if (!departmentId) return {};
  return readStore()[departmentId] || {};
};

const isDeptProvider = (p: string): p is DeptKeyProvider =>
  p === 'qwen' || p === 'tavily' || p === 'anymailfinder';

/** 供 apiKeyPool 合并：当前登录用户所属部门的 Key（队首优先） */
export const listDeptPoolKeysForProvider = (provider: string): string[] => {
  const deptId = resolutionCtx.departmentId;
  if (!deptId || !isDeptProvider(provider)) return [];
  return uniqueKeys(getDeptApiKeysBundle(deptId)[provider]?.keys || []);
};

export const getDeptPoolMeta = (
  provider: DeptKeyProvider,
  departmentId?: string
): DeptProviderKeys | null => {
  const deptId = departmentId ?? resolutionCtx.departmentId;
  if (!deptId) return null;
  const meta = getDeptApiKeysBundle(deptId)[provider];
  if (!meta?.keys?.length) return null;
  return meta;
};

export const setDeptPoolKeys = (
  departmentId: string,
  provider: DeptKeyProvider,
  keys: string[],
  opts?: { baseUrl?: string; modelId?: string; updatedBy?: string }
): DeptProviderKeys => {
  const cleaned = uniqueKeys(keys);
  const store = readStore();
  const prev = store[departmentId] || {};
  const nextMeta: DeptProviderKeys = {
    keys: cleaned,
    baseUrl: opts?.baseUrl?.trim() || prev[provider]?.baseUrl,
    modelId: opts?.modelId?.trim() || prev[provider]?.modelId,
    updatedAt: Date.now(),
    updatedBy: opts?.updatedBy || resolutionCtx.username,
  };
  if (!nextMeta.baseUrl) delete nextMeta.baseUrl;
  if (!nextMeta.modelId) delete nextMeta.modelId;
  store[departmentId] = {
    ...prev,
    [provider]: nextMeta,
  };
  writeStore(store);
  void syncDeptKeysToCloud(departmentId, store[departmentId]);
  return nextMeta;
};

/** 判断某 Key 是否属于当前部门池（用于轮换时写回部门池而非全局） */
export const isKeyInCurrentDeptPool = (provider: string, key: string): boolean => {
  const k = normalizeApiKey(key);
  if (!k) return false;
  return listDeptPoolKeysForProvider(provider).includes(k);
};

export const promoteDeptPoolKey = (provider: DeptKeyProvider, key: string) => {
  const deptId = resolutionCtx.departmentId;
  if (!deptId) return;
  const k = normalizeApiKey(key);
  if (!k) return;
  const keys = listDeptPoolKeysForProvider(provider);
  if (!keys.includes(k)) return;
  const rest = keys.filter((x) => x !== k);
  const meta = getDeptPoolMeta(provider, deptId);
  setDeptPoolKeys(deptId, provider, [k, ...rest], {
    baseUrl: meta?.baseUrl,
    modelId: meta?.modelId,
  });
};

export const rotateDeptPoolKeyToEnd = (provider: DeptKeyProvider, key: string) => {
  const deptId = resolutionCtx.departmentId;
  if (!deptId) return;
  const k = normalizeApiKey(key);
  if (!k) return;
  const keys = listDeptPoolKeysForProvider(provider);
  if (!keys.includes(k)) return;
  const rest = keys.filter((x) => x !== k);
  const meta = getDeptPoolMeta(provider, deptId);
  setDeptPoolKeys(deptId, provider, [...rest, k], {
    baseUrl: meta?.baseUrl,
    modelId: meta?.modelId,
  });
};

const cloudProviderId = (departmentId: string) => `__dept_keys__${departmentId}`;

const syncDeptKeysToCloud = async (departmentId: string, bundle: DeptApiKeysBundle) => {
  if (!isSupabaseConfigured()) return;
  try {
    await saveApiConfig({
      provider: cloudProviderId(departmentId),
      apiKey: JSON.stringify(bundle),
    });
  } catch (e) {
    console.warn('[deptApiKeys] cloud sync failed', e);
  }
};

export const hydrateDeptApiKeysFromCloud = async (departmentId: string | undefined) => {
  if (!departmentId || !isSupabaseConfigured()) return;
  try {
    const cfg = await getApiConfig(cloudProviderId(departmentId));
    if (!cfg?.apiKey?.trim()) return;
    let bundle: DeptApiKeysBundle = {};
    try {
      bundle = JSON.parse(cfg.apiKey) as DeptApiKeysBundle;
    } catch {
      return;
    }
    const store = readStore();
    const local = store[departmentId] || {};
    const merged: DeptApiKeysBundle = { ...local };
    (['qwen', 'tavily', 'anymailfinder'] as DeptKeyProvider[]).forEach((p) => {
      const cloudKeys = uniqueKeys(bundle[p]?.keys || []);
      const localKeys = uniqueKeys(local[p]?.keys || []);
      if (!cloudKeys.length && !localKeys.length) return;
      merged[p] = {
        keys: uniqueKeys([...localKeys, ...cloudKeys]),
        baseUrl: local[p]?.baseUrl || bundle[p]?.baseUrl,
        modelId: local[p]?.modelId || bundle[p]?.modelId,
        updatedAt: Math.max(local[p]?.updatedAt || 0, bundle[p]?.updatedAt || 0) || Date.now(),
        updatedBy: local[p]?.updatedBy || bundle[p]?.updatedBy,
      };
    });
    store[departmentId] = merged;
    writeStore(store);
  } catch (e) {
    console.warn('[deptApiKeys] hydrate failed', e);
  }
};

export const DEPT_KEY_PROVIDER_LABELS: Record<DeptKeyProvider, { title: string; hint: string }> = {
  qwen: {
    title: '通义千问 Qwen',
    hint: '用于背景调查、策略对话等 AI 分析。本部门用户将优先使用主管添加的 Key。',
  },
  tavily: {
    title: 'Tavily 搜索',
    hint: '用于客户搜索 / 联网取证。本部门用户将优先使用主管添加的 Key。',
  },
  anymailfinder: {
    title: 'Anymail Finder',
    hint: '用于决策人邮箱挖掘。本部门用户将优先使用主管添加的 Key。',
  },
};
