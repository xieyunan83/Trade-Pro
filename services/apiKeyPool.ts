/**
 * 通用 API Key 池：多 Key + 本月额度耗尽标记 + 轮换
 * 云端仍按 provider 一行存储，apiKey 字段为 JSON：{ keys: string[], baseUrl?, modelId? } 或纯字符串/数组（兼容旧数据）
 */
export type ApiKeyPoolProvider =
  | 'qwen'
  | 'gemini'
  | 'wan'
  | 'hunter'
  | 'findymail'
  | 'anymailfinder'
  | 'anysearch'
  | 'tavily';

export type ApiKeyPoolMeta = {
  keys: string[];
  baseUrl?: string;
  modelId?: string;
};

export type ApiKeyStatus = {
  key: string;
  label: string;
  exhausted: boolean;
  active: boolean;
  disabled?: boolean;
};

const poolLsKey = (p: ApiKeyPoolProvider) => `trade_scout_key_pool_${p}`;
const exhaustedLsKey = (p: ApiKeyPoolProvider) => `trade_scout_key_exhausted_${p}`;
const legacySingleKey: Partial<Record<ApiKeyPoolProvider, string>> = {
  qwen: 'trade_scout_qwen_api_key',
  gemini: 'trade_scout_gemini_api_key',
  wan: 'trade_scout_wan_api_key',
  hunter: 'trade_scout_hunter_api_key',
  findymail: 'trade_scout_findymail_api_key',
  anymailfinder: 'trade_scout_anymail_finder_api_key',
  anysearch: 'trade_scout_anysearch_api_key',
  tavily: 'trade_scout_tavily_api_key',
};

const monthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const maskApiKey = (key: string): string => {
  const k = (key || '').trim();
  if (k.length <= 10) return '••••';
  return `${k.slice(0, 8)}…${k.slice(-4)}`;
};

export const normalizeApiKey = (key: string): string =>
  (key || '').replace(/^Bearer\s+/i, '').replace(/\s+/g, '').trim();

export const isQuotaLikeError = (err: unknown): boolean => {
  const msg = String((err as any)?.message || err || '');
  return /套餐额度已用尽|AllocationQuota|Allocated quota|insufficient_quota|402|payment required|credit|余额不足|额度.*用尽|quota.*exceed|exceeded.*quota/i.test(
    msg
  );
};

export const isRateLikeError = (err: unknown): boolean => {
  const msg = String((err as any)?.message || err || '');
  if (isQuotaLikeError(err)) return false;
  return /请求过于频繁|rate\s*limit|429|Throttling|Too many requests|Rate Limit/i.test(msg);
};

export const isAuthLikeError = (err: unknown): boolean => {
  const msg = String((err as any)?.message || err || '');
  return /401|403|invalid.?api.?key|incorrect.?api.?key|unauthorized|鉴权失败|API key not valid/i.test(msg);
};

/** 解析云端/本地存的池：支持 {keys}, 数组, 或单字符串 */
export const parseApiKeyPoolPayload = (raw: string | null | undefined): ApiKeyPoolMeta => {
  const text = (raw || '').trim();
  if (!text) return { keys: [] };
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return { keys: uniqueKeys(parsed.map(String)) };
    }
    if (parsed && typeof parsed === 'object') {
      const keysRaw = Array.isArray(parsed.keys)
        ? parsed.keys
        : parsed.apiKey
          ? [parsed.apiKey]
          : [];
      return {
        keys: uniqueKeys(keysRaw.map(String)),
        baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
        modelId: typeof parsed.modelId === 'string' ? parsed.modelId : undefined,
      };
    }
  } catch {
    /* plain key string */
  }
  return { keys: uniqueKeys([text]) };
};

export const serializeApiKeyPoolPayload = (meta: ApiKeyPoolMeta): string => {
  const keys = uniqueKeys(meta.keys || []);
  return JSON.stringify({
    keys,
    ...(meta.baseUrl?.trim() ? { baseUrl: meta.baseUrl.trim() } : {}),
    ...(meta.modelId?.trim() ? { modelId: meta.modelId.trim() } : {}),
  });
};

const uniqueKeys = (keys: string[]): string[] => [
  ...new Set(keys.map(normalizeApiKey).filter(Boolean)),
];

type ExhaustedMap = { month: string; keys: string[] };

const readExhausted = (provider: ApiKeyPoolProvider): Set<string> => {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(exhaustedLsKey(provider));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as ExhaustedMap;
    if (parsed.month !== monthKey()) {
      localStorage.removeItem(exhaustedLsKey(provider));
      return new Set();
    }
    return new Set((parsed.keys || []).map(normalizeApiKey).filter(Boolean));
  } catch {
    return new Set();
  }
};

const writeExhausted = (provider: ApiKeyPoolProvider, set: Set<string>) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(
    exhaustedLsKey(provider),
    JSON.stringify({ month: monthKey(), keys: [...set] } satisfies ExhaustedMap)
  );
};

export const markPoolKeyExhausted = (provider: ApiKeyPoolProvider, key: string) => {
  const k = normalizeApiKey(key);
  if (!k) return;
  const set = readExhausted(provider);
  set.add(k);
  writeExhausted(provider, set);
  console.warn(`[keypool:${provider}] exhausted this month:`, maskApiKey(k));
  // 把耗尽的放到队尾，优先用其它 Key
  const all = listPoolKeys(provider).filter((x) => x !== k);
  if (all.length) setPoolKeys(provider, [...all, k]);
};

export const clearPoolExhausted = (provider: ApiKeyPoolProvider) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(exhaustedLsKey(provider));
};

export const listPoolKeys = (provider: ApiKeyPoolProvider): string[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(poolLsKey(provider));
    if (raw) {
      const meta = parseApiKeyPoolPayload(raw);
      if (meta.keys.length) return meta.keys;
    }
  } catch {
    /* ignore */
  }
  // 兼容旧单 Key + Tavily 专用池
  const legacy = legacySingleKey[provider];
  if (legacy) {
    const single = localStorage.getItem(legacy)?.trim();
    if (single) {
      const meta = parseApiKeyPoolPayload(single);
      if (meta.keys.length) return meta.keys;
      return [normalizeApiKey(single)].filter(Boolean);
    }
  }
  if (provider === 'tavily') {
    try {
      const raw = localStorage.getItem('trade_scout_tavily_api_keys');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return uniqueKeys(parsed.map(String));
      }
    } catch {
      /* ignore */
    }
  }
  return [];
};

export const getUsablePoolKeys = (provider: ApiKeyPoolProvider): string[] => {
  const exhausted = readExhausted(provider);
  return listPoolKeys(provider).filter((k) => !exhausted.has(k));
};

export const getActivePoolKey = (provider: ApiKeyPoolProvider): string =>
  getUsablePoolKeys(provider)[0] || listPoolKeys(provider)[0] || '';

export const getPoolKeyStatuses = (provider: ApiKeyPoolProvider): ApiKeyStatus[] => {
  const all = listPoolKeys(provider);
  const exhausted = readExhausted(provider);
  const active = getUsablePoolKeys(provider)[0] || '';
  return all.map((key) => ({
    key,
    label: maskApiKey(key),
    exhausted: exhausted.has(key),
    active: key === active,
  }));
};

/** 写入 Key 池，并同步旧版单 Key / Tavily 池字段以兼容旧读取路径 */
export const setPoolKeys = (
  provider: ApiKeyPoolProvider,
  keys: string[],
  meta?: { baseUrl?: string; modelId?: string }
) => {
  if (typeof localStorage === 'undefined') return;
  const cleaned = uniqueKeys(keys);
  const payload = serializeApiKeyPoolPayload({
    keys: cleaned,
    baseUrl: meta?.baseUrl,
    modelId: meta?.modelId,
  });
  localStorage.setItem(poolLsKey(provider), payload);

  const legacy = legacySingleKey[provider];
  if (legacy) {
    localStorage.setItem(legacy, cleaned[0] || '');
  }
  if (provider === 'tavily') {
    localStorage.setItem('trade_scout_tavily_api_keys', JSON.stringify(cleaned));
    localStorage.setItem('trade_scout_tavily_api_key', cleaned[0] || '');
  }
  if (provider === 'qwen' && meta?.baseUrl?.trim()) {
    localStorage.setItem('trade_scout_qwen_base_url', meta.baseUrl.trim());
  }
  if (provider === 'qwen' && meta?.modelId?.trim()) {
    localStorage.setItem('trade_scout_qwen_model_id', meta.modelId.trim());
  }
  if (provider === 'gemini' && meta?.modelId?.trim()) {
    localStorage.setItem('trade_scout_gemini_model_id', meta.modelId.trim());
  }
  if (provider === 'wan' && meta?.baseUrl?.trim()) {
    localStorage.setItem('trade_scout_wan_base_url', meta.baseUrl.trim());
  }
  if (provider === 'wan' && meta?.modelId?.trim()) {
    localStorage.setItem('trade_scout_wan_model_id', meta.modelId.trim());
  }
};

export const addPoolKey = (provider: ApiKeyPoolProvider, key: string): string[] => {
  const k = normalizeApiKey(key);
  if (!k) return listPoolKeys(provider);
  const next = uniqueKeys([...listPoolKeys(provider), k]);
  setPoolKeys(provider, next);
  return next;
};

export const removePoolKey = (provider: ApiKeyPoolProvider, key: string): string[] => {
  const k = normalizeApiKey(key);
  const next = listPoolKeys(provider).filter((x) => x !== k);
  setPoolKeys(provider, next);
  return next;
};

/** 成功用过某把 Key 时提到队首，下次优先 */
export const promotePoolKey = (provider: ApiKeyPoolProvider, key: string) => {
  const k = normalizeApiKey(key);
  if (!k) return;
  const rest = listPoolKeys(provider).filter((x) => x !== k);
  setPoolKeys(provider, [k, ...rest]);
};

/**
 * 按池轮换执行：额度耗尽切下一把；限流短退避后可换 Key；鉴权失败标记耗尽并换 Key。
 */
export async function withApiKeyRotation<T>(
  provider: ApiKeyPoolProvider,
  fn: (apiKey: string, attempt: number) => Promise<T>,
  opts?: { maxKeys?: number }
): Promise<T> {
  const usable = getUsablePoolKeys(provider);
  const keys = usable.length ? usable : listPoolKeys(provider);
  if (!keys.length) {
    throw new Error(`未配置 ${provider} API Key（请在管理后台「API 密钥配置」添加 Key 池）`);
  }
  const max = Math.min(opts?.maxKeys ?? keys.length, keys.length);
  let lastErr: unknown;
  for (let i = 0; i < max; i++) {
    const key = keys[i];
    try {
      const result = await fn(key, i);
      promotePoolKey(provider, key);
      return result;
    } catch (err) {
      lastErr = err;
      if (isQuotaLikeError(err) || isAuthLikeError(err)) {
        markPoolKeyExhausted(provider, key);
        console.warn(`[keypool:${provider}] switch key after error:`, maskApiKey(key), err);
        continue;
      }
      if (isRateLikeError(err) && i < max - 1) {
        console.warn(`[keypool:${provider}] rate limit, try next key:`, maskApiKey(key));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`${provider} Key 池全部不可用：${String(lastErr)}`);
}

/** 从云端一行配置灌入本地池（不覆盖本机已有非空池，除非 force） */
export const hydrateProviderPoolFromCloud = (
  provider: ApiKeyPoolProvider,
  cloudApiKey: string,
  opts?: { baseUrl?: string; modelId?: string; force?: boolean }
) => {
  const meta = parseApiKeyPoolPayload(cloudApiKey);
  if (!meta.keys.length) return;
  const local = listPoolKeys(provider);
  if (local.length && !opts?.force) {
    // 合并云端新 Key，保留本机顺序优先
    const merged = uniqueKeys([...local, ...meta.keys]);
    setPoolKeys(provider, merged, {
      baseUrl: opts?.baseUrl || meta.baseUrl,
      modelId: opts?.modelId || meta.modelId,
    });
    return;
  }
  setPoolKeys(provider, meta.keys, {
    baseUrl: opts?.baseUrl || meta.baseUrl,
    modelId: opts?.modelId || meta.modelId,
  });
};
