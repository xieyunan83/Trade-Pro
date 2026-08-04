/**
 * 已排除客户（非目标客户）：本机 + Supabase 云端同步
 * 客户搜索时过滤，避免重复背调查烧 Token
 */
import { getApiConfig, isSupabaseConfigured, saveApiConfig } from './supabase';

export type ExcludedCompany = {
  domain: string;
  name: string;
  excludedAt: number;
  reason?: string;
};

const LS_KEY = 'trade_scout_excluded_companies';
const CLOUD_PROVIDER = '__excluded_companies__';

const cleanDomain = (d: string) =>
  (d || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .trim()
    .toLowerCase();

const normalizeList = (raw: unknown): ExcludedCompany[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x: any) => ({
      domain: cleanDomain(String(x?.domain || '')),
      name: String(x?.name || '').trim(),
      excludedAt: Number(x?.excludedAt) || Date.now(),
      reason: x?.reason ? String(x.reason) : undefined,
    }))
    .filter((x) => x.domain || x.name);
};

export const getExcludedCompanies = (): ExcludedCompany[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    return normalizeList(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));
  } catch {
    return [];
  }
};

const persistLocal = (list: ExcludedCompany[]) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify(normalizeList(list)));
};

const persistCloud = async (list: ExcludedCompany[]) => {
  if (!isSupabaseConfigured()) return false;
  try {
    return await saveApiConfig({
      provider: CLOUD_PROVIDER,
      apiKey: JSON.stringify(normalizeList(list)),
    });
  } catch (e) {
    console.warn('[excluded] cloud save failed', e);
    return false;
  }
};

export const hydrateExcludedCompaniesFromCloud = async (): Promise<ExcludedCompany[]> => {
  const local = getExcludedCompanies();
  if (!isSupabaseConfigured()) return local;
  try {
    const cfg = await getApiConfig(CLOUD_PROVIDER);
    if (!cfg?.apiKey) return local;
    let remote: ExcludedCompany[] = [];
    try {
      remote = normalizeList(JSON.parse(cfg.apiKey));
    } catch {
      return local;
    }
    // 按 domain/name 合并，保留较早排除时间
    const map = new Map<string, ExcludedCompany>();
    const keyOf = (x: ExcludedCompany) =>
      x.domain ? `d:${x.domain}` : `n:${x.name.toLowerCase()}`;
    for (const x of [...remote, ...local]) {
      const k = keyOf(x);
      const prev = map.get(k);
      if (!prev || x.excludedAt < prev.excludedAt) map.set(k, x);
    }
    const merged = Array.from(map.values());
    persistLocal(merged);
    return merged;
  } catch (e) {
    console.warn('[excluded] hydrate failed', e);
    return local;
  }
};

export const isCompanyExcluded = (
  domainOrWebsite?: string,
  name?: string,
  list?: ExcludedCompany[]
): boolean => {
  const excluded = list || getExcludedCompanies();
  const domain = cleanDomain(domainOrWebsite || '');
  const nameKey = (name || '').trim().toLowerCase();
  return excluded.some((x) => {
    if (domain && x.domain && domain === x.domain) return true;
    if (nameKey && x.name && nameKey === x.name.toLowerCase()) return true;
    return false;
  });
};

export const addExcludedCompany = async (opts: {
  domain?: string;
  name?: string;
  reason?: string;
}): Promise<ExcludedCompany[]> => {
  const domain = cleanDomain(opts.domain || '');
  const name = (opts.name || '').trim();
  if (!domain && !name) return getExcludedCompanies();

  const list = getExcludedCompanies().filter((x) => {
    if (domain && x.domain === domain) return false;
    if (name && x.name.toLowerCase() === name.toLowerCase()) return false;
    return true;
  });
  list.unshift({
    domain,
    name: name || domain,
    excludedAt: Date.now(),
    reason: opts.reason,
  });
  persistLocal(list);
  // 云端同步不阻塞 UI（否则背调页「排除」会像没反应）
  void persistCloud(list);
  return list;
};

export const removeExcludedCompany = async (
  domainOrName: string
): Promise<ExcludedCompany[]> => {
  const key = cleanDomain(domainOrName) || domainOrName.trim().toLowerCase();
  const list = getExcludedCompanies().filter(
    (x) => x.domain !== key && x.name.toLowerCase() !== key
  );
  persistLocal(list);
  void persistCloud(list);
  return list;
};

/** 过滤客户搜索结果 */
export const filterExcludedSearchResults = <
  T extends { website?: string; name?: string; domain?: string }
>(
  results: T[]
): T[] => {
  const excluded = getExcludedCompanies();
  if (!excluded.length) return results;
  return results.filter(
    (r) => !isCompanyExcluded(r.website || r.domain, r.name, excluded)
  );
};
