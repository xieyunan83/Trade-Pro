/** 用户自定义关键词 / 国家分类（本地持久化） */

const KW_KEY = 'trade_scout_custom_keywords';
const COUNTRY_KEY = 'trade_scout_custom_countries';

const readList = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const writeList = (key: string, list: string[]) => {
  const unique = Array.from(new Set(list.map((s) => s.trim()).filter(Boolean)));
  localStorage.setItem(key, JSON.stringify(unique));
  return unique;
};

export const getCustomKeywords = (): string[] => readList(KW_KEY);
export const getCustomCountries = (): string[] => readList(COUNTRY_KEY);

export const saveCustomKeywords = (list: string[]) => writeList(KW_KEY, list);
export const saveCustomCountries = (list: string[]) => writeList(COUNTRY_KEY, list);

export const addCustomKeyword = (name: string): string[] => {
  const n = name.trim();
  if (!n) return getCustomKeywords();
  return saveCustomKeywords([...getCustomKeywords(), n]);
};

export const renameCustomKeyword = (from: string, to: string): string[] => {
  const t = to.trim();
  if (!t) return getCustomKeywords();
  return saveCustomKeywords(getCustomKeywords().map((k) => (k === from ? t : k)));
};

export const removeCustomKeyword = (name: string): string[] =>
  saveCustomKeywords(getCustomKeywords().filter((k) => k !== name));

export const addCustomCountry = (name: string): string[] => {
  const n = name.trim();
  if (!n) return getCustomCountries();
  return saveCustomCountries([...getCustomCountries(), n]);
};

export const renameCustomCountry = (from: string, to: string): string[] => {
  const t = to.trim();
  if (!t) return getCustomCountries();
  return saveCustomCountries(getCustomCountries().map((k) => (k === from ? t : k)));
};

export const removeCustomCountry = (name: string): string[] =>
  saveCustomCountries(getCustomCountries().filter((k) => k !== name));

/** 从现有记录中收集出现过的词，合并进自定义列表 */
export const mergeObservedKeywords = (observed: string[]) => {
  const cur = getCustomKeywords();
  return saveCustomKeywords([...cur, ...observed.filter((o) => o && o !== '未分类')]);
};

export const mergeObservedCountries = (observed: string[]) => {
  const cur = getCustomCountries();
  return saveCustomCountries([...cur, ...observed.filter((o) => o && o !== '未分类')]);
};
