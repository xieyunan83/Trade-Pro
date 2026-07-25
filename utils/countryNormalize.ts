import { CONTINENTS, findCountryByEn, type CountryItem } from '../data/countriesByContinent';

/** 常见城市 → 国家英文 */
const CITY_TO_COUNTRY: Record<string, string> = {
  warsaw: 'Poland',
  krakow: 'Poland',
  cracow: 'Poland',
  gdansk: 'Poland',
  wroclaw: 'Poland',
  amsterdam: 'Netherlands',
  rotterdam: 'Netherlands',
  utrecht: 'Netherlands',
  eindhoven: 'Netherlands',
  thehague: 'Netherlands',
  'den haag': 'Netherlands',
  london: 'United Kingdom',
  manchester: 'United Kingdom',
  birmingham: 'United Kingdom',
  berlin: 'Germany',
  munich: 'Germany',
  hamburg: 'Germany',
  paris: 'France',
  lyon: 'France',
  newyork: 'United States',
  'new york': 'United States',
  'los angeles': 'United States',
  chicago: 'United States',
  tokyo: 'Japan',
  shanghai: 'China',
  beijing: 'China',
  shenzhen: 'China',
  guangzhou: 'China',
  hongkong: 'Hong Kong',
  singapore: 'Singapore',
};

const ALIAS: Record<string, string> = {
  usa: 'United States',
  us: 'United States',
  'u.s.': 'United States',
  'u.s.a.': 'United States',
  america: 'United States',
  uk: 'United Kingdom',
  'u.k.': 'United Kingdom',
  britain: 'United Kingdom',
  england: 'United Kingdom',
  holland: 'Netherlands',
  nederland: 'Netherlands',
  nl: 'Netherlands',
  pl: 'Poland',
  polska: 'Poland',
  deutschland: 'Germany',
  de: 'Germany',
  fr: 'France',
  cn: 'China',
  prc: 'China',
};

const allCountries = (): CountryItem[] => CONTINENTS.flatMap((c) => c.countries);

const resolveCountryItem = (raw: string): CountryItem | undefined => {
  const cleaned = raw
    .replace(/[)）]+$/g, '')
    .replace(/^[(（]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^n\/?a$/i.test(cleaned) || cleaned === 'Global' || cleaned === '未分类') return undefined;

  const lower = cleaned.toLowerCase();
  const alias = ALIAS[lower];
  if (alias) return findCountryByEn(alias);

  const direct = findCountryByEn(cleaned);
  if (direct) return direct;

  // 城市
  const cityKey = lower.replace(/\s+/g, '');
  const fromCity = CITY_TO_COUNTRY[lower] || CITY_TO_COUNTRY[cityKey];
  if (fromCity) return findCountryByEn(fromCity);

  // 在长字符串中匹配国家名（如 "英国 (品牌总部) / 中国深圳"）
  for (const c of allCountries()) {
    if (cleaned.includes(c.zh) || lower.includes(c.en.toLowerCase())) return c;
  }

  return undefined;
};

/**
 * 将乱七八糟的总部/城市字符串规范为统一中文国名，便于归类。
 * 无法识别时返回「未分类」，避免出现 Warsaw / Poland) 等脏分组。
 */
export const normalizeCountryZh = (raw?: string | null): string => {
  if (!raw || !String(raw).trim()) return '未分类';

  const text = String(raw).trim();
  // 多段用 / , ; 拆开，优先取能识别的国家
  const parts = text.split(/[/|；;，,]+/).map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    // 去掉括号内说明
    const noParen = part.replace(/[（(][^）)]*[）)]/g, ' ').trim();
    const hit = resolveCountryItem(noParen) || resolveCountryItem(part);
    if (hit) return hit.zh;
  }

  // 整串再试一次
  const hit = resolveCountryItem(text);
  if (hit) return hit.zh;

  return '未分类';
};

export const normalizeCountryEn = (raw?: string | null): string => {
  const zh = normalizeCountryZh(raw);
  if (zh === '未分类') return 'Unknown';
  const item = allCountries().find((c) => c.zh === zh);
  return item?.en || zh;
};
