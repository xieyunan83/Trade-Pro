/**
 * 客户端负载治理：跨标签页协调重任务并发，高峰自动降级双引擎。
 * 不改变业务接口；无云端时仍可工作（BroadcastChannel + localStorage）。
 */

export type HeavyJobKind = 'ai' | 'search' | 'automation' | 'creative' | 'sync';

type HeavyEntry = { id: string; kind: HeavyJobKind; at: number; tab: string };

const LS_HEAVY = 'trade_scout_heavy_jobs_v1';
const LS_COOLDOWN = 'trade_scout_shared_cooldown_until';
const CHANNEL = 'trade_pro_load_gov';
const ENTRY_TTL_MS = 12 * 60_000;
const TAB_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** 本机+跨标签合计重任务超过此阈值 → 优先单引擎 */
const SINGLE_ENGINE_HEAVY_THRESHOLD = 3;
/** 本标签内 AI 同时数软上限（额外还有队列自己的 MAX_CONCURRENT） */
const LOCAL_AI_SOFT_CAP = 2;

let channel: BroadcastChannel | null = null;
const localIds = new Set<string>();

const readEntries = (): HeavyEntry[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_HEAVY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as HeavyEntry[];
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr.filter((e) => e && e.id && now - (e.at || 0) < ENTRY_TTL_MS);
  } catch {
    return [];
  }
};

const writeEntries = (entries: HeavyEntry[]) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_HEAVY, JSON.stringify(entries.slice(-80)));
  } catch {
    /* quota */
  }
};

const ensureChannel = () => {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (ev) => {
      const data = ev?.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'heavy_changed') {
        /* 其它标签已写 LS，读即可 */
      }
      if (data.type === 'cooldown' && typeof data.until === 'number') {
        try {
          const prev = Number(localStorage.getItem(LS_COOLDOWN) || 0);
          if (data.until > prev) localStorage.setItem(LS_COOLDOWN, String(data.until));
        } catch {
          /* ignore */
        }
      }
    };
  } catch {
    channel = null;
  }
  return channel;
};

const broadcast = (msg: unknown) => {
  try {
    ensureChannel()?.postMessage(msg);
  } catch {
    /* ignore */
  }
};

export const getHeavyJobCount = (kind?: HeavyJobKind): number => {
  const entries = readEntries();
  if (!kind) return entries.length;
  return entries.filter((e) => e.kind === kind).length;
};

export const beginHeavyJob = (kind: HeavyJobKind = 'ai'): string => {
  ensureChannel();
  const id = `${TAB_ID}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const entries = readEntries().filter((e) => e.id !== id);
  entries.push({ id, kind, at: Date.now(), tab: TAB_ID });
  writeEntries(entries);
  localIds.add(id);
  broadcast({ type: 'heavy_changed', id, kind, op: 'begin' });
  return id;
};

export const endHeavyJob = (id: string | null | undefined) => {
  if (!id) return;
  localIds.delete(id);
  writeEntries(readEntries().filter((e) => e.id !== id));
  broadcast({ type: 'heavy_changed', id, op: 'end' });
};

/** 页面卸载时清掉本标签登记，避免幽灵占坑 */
export const sweepOwnHeavyJobs = () => {
  if (!localIds.size) return;
  const mine = new Set(localIds);
  localIds.clear();
  writeEntries(readEntries().filter((e) => !mine.has(e.id)));
  broadcast({ type: 'heavy_changed', op: 'sweep' });
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => sweepOwnHeavyJobs());
  ensureChannel();
}

export const publishSharedCooldown = (untilMs: number) => {
  if (typeof localStorage === 'undefined') return;
  try {
    const prev = Number(localStorage.getItem(LS_COOLDOWN) || 0);
    if (untilMs > prev) localStorage.setItem(LS_COOLDOWN, String(untilMs));
  } catch {
    /* ignore */
  }
  broadcast({ type: 'cooldown', until: untilMs });
};

export const getSharedCooldownUntil = (): number => {
  if (typeof localStorage === 'undefined') return 0;
  try {
    return Number(localStorage.getItem(LS_COOLDOWN) || 0) || 0;
  } catch {
    return 0;
  }
};

const forceSingleFromEnv = (): boolean => {
  try {
    const v = String((import.meta as any)?.env?.VITE_LOAD_CAP_SINGLE_ENGINE || '').trim();
    if (v === '1' || v === 'true') return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('trade_scout_load_cap_single') === '1') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
};

/** 高峰时把 both 收成单路，降低上游扇出 */
export const shouldPreferSingleEngine = (): boolean => {
  if (forceSingleFromEnv()) return true;
  if (Date.now() < getSharedCooldownUntil()) return true;
  return getHeavyJobCount() >= SINGLE_ENGINE_HEAVY_THRESHOLD;
};

export const collapseEngineUnderLoad = <T extends string>(
  engine: T
): T | 'gemini' | 'qwen' => {
  if (engine !== ('both' as T)) return engine;
  if (!shouldPreferSingleEngine()) return engine;
  // 有 Gemini 配置倾向走 Gemini→千问；否则仅千问
  try {
    if (typeof localStorage !== 'undefined') {
      const hasGemini =
        !!localStorage.getItem('trade_scout_gemini_api_key')?.trim() ||
        !!localStorage.getItem('trade_scout_key_pool_gemini');
      return (hasGemini ? 'gemini' : 'qwen') as T | 'gemini' | 'qwen';
    }
  } catch {
    /* ignore */
  }
  return 'qwen';
};

/** 队列泵：若本机 AI 已满，稍等再跑（带抖动） */
export const waitForLocalAiSlot = async (
  shouldStop?: () => boolean,
  softCap = LOCAL_AI_SOFT_CAP
): Promise<void> => {
  while (getHeavyJobCount('ai') >= softCap) {
    if (shouldStop?.()) return;
    await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 600)));
  }
  // 错峰
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 400)));
};

export const withHeavyJob = async <T,>(
  kind: HeavyJobKind,
  fn: () => Promise<T>
): Promise<T> => {
  const id = beginHeavyJob(kind);
  try {
    return await fn();
  } finally {
    endHeavyJob(id);
  }
};

export const describeLoadGovernor = (): string => {
  const n = getHeavyJobCount();
  const ai = getHeavyJobCount('ai');
  const cool = Math.max(0, Math.ceil((getSharedCooldownUntil() - Date.now()) / 1000));
  return `重任务 ${n}（AI ${ai}）${cool > 0 ? ` · 冷却 ${cool}s` : ''}${
    shouldPreferSingleEngine() ? ' · 已降级单引擎' : ''
  }`;
};
