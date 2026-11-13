import { CONTINENTS, findCountryByEn, type CountryItem } from '../data/countriesByContinent';

/** 常见城市 / 地区 → 国家英文 */
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
  hangzhou: 'China',
  nanjing: 'China',
  chengdu: 'China',
  wuhan: 'China',
  tianjin: 'China',
  chongqing: 'China',
  xiamen: 'China',
  ningbo: 'China',
  dongguan: 'China',
  foshan: 'China',
  suzhou: 'China',
  hongkong: 'Hong Kong',
  'hong kong': 'Hong Kong',
  香港: 'Hong Kong',
  上海: 'China',
  北京: 'China',
  深圳: 'China',
  广州: 'China',
  singapore: 'Singapore',
  santiago: 'Chile',
  圣地亚哥: 'Chile',
  alicante: 'Spain',
  madrid: 'Spain',
  barcelona: 'Spain',
  dubai: 'United Arab Emirates',
  'abu dhabi': 'United Arab Emirates',
  moscow: 'Russia',
  istanbul: 'Turkey',
  bangkok: 'Thailand',
  jakarta: 'Indonesia',
  mumbai: 'India',
  delhi: 'India',
  'new delhi': 'India',
  bangalore: 'India',
  sydney: 'Australia',
  melbourne: 'Australia',
  auckland: 'New Zealand',
  toronto: 'Canada',
  vancouver: 'Canada',
  'sao paulo': 'Brazil',
  'mexico city': 'Mexico',
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
  'great britain': 'United Kingdom',
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
  'mainland china': 'China',
  中国大陆: 'China',
  内地: 'China',
  中国内地: 'China',
  'hong kong sar': 'Hong Kong',
  'hong kong, china': 'Hong Kong',
  'hong kong china': 'Hong Kong',
  中国香港特别行政区: 'Hong Kong',
  香港特别行政区: 'Hong Kong',
  'taiwan, china': 'Taiwan',
  'taiwan china': 'Taiwan',
  中国台湾: 'Taiwan',
  台湾: 'Taiwan',
  korea: 'South Korea',
  'republic of korea': 'South Korea',
  uae: 'United Arab Emirates',
  emirates: 'United Arab Emirates',
  russia: 'Russia',
  'russian federation': 'Russia',
  vietnam: 'Vietnam',
  'viet nam': 'Vietnam',
};

/** 大洲等非国家，直接丢弃 */
const NON_COUNTRY = new Set(
  [
    'asia',
    'europe',
    'africa',
    'oceania',
    'antarctica',
    'global',
    'worldwide',
    'international',
    '地球',
    '全球',
    '国际',
    '不限',
    '亚洲',
    '欧洲',
    '非洲',
    '北美洲',
    '南美洲',
    '大洋洲',
    '美洲',
    '中东',
    'middle east',
    'eu',
    'europe union',
    'european union',
    'n/a',
    'na',
    'unknown',
    '未分类',
  ].map((s) => s.toLowerCase())
);

const allCountries = (): CountryItem[] => CONTINENTS.flatMap((c) => c.countries);

/** 按名称长度降序，避免「中国香港」误匹配成「中国」 */
let cachedMatchers: { item: CountryItem; zh: string; en: string }[] | null = null;
const countryMatchers = () => {
  if (cachedMatchers) return cachedMatchers;
  cachedMatchers = allCountries()
    .map((item) => ({
      item,
      zh: item.zh,
      en: item.en.toLowerCase(),
    }))
    .sort((a, b) => Math.max(b.zh.length, b.en.length) - Math.max(a.zh.length, a.en.length));
  return cachedMatchers;
};

const stripNoise = (raw: string): string =>
  raw
    // 去掉括号说明：推测 / 域名后缀 / 历史总部…
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .replace(/（[^）]*$/g, ' ')
    .replace(/\([^)]*$/g, ' ')
    .replace(/基于[^，,。；;]*/g, ' ')
    .replace(/推测[^，,。；;]*/g, ' ')
    .replace(/历史总部[^，,。；;]*/g, ' ')
    .replace(/现无合法实体[^，,。；;]*/g, ' ')
    .replace(/品牌总部[^，,。；;]*/g, ' ')
    .replace(/[)）]+$/g, '')
    .replace(/^[(（]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const resolveCountryItem = (raw: string): CountryItem | undefined => {
  const cleaned = stripNoise(raw);
  if (!cleaned) return undefined;
  const lower = cleaned.toLowerCase();
  if (NON_COUNTRY.has(lower)) return undefined;

  const alias = ALIAS[lower] || ALIAS[cleaned];
  if (alias) return findCountryByEn(alias);

  const direct = findCountryByEn(cleaned);
  if (direct) return direct;

  // 城市 / 地区
  const cityKey = lower.replace(/\s+/g, '');
  const fromCity = CITY_TO_COUNTRY[lower] || CITY_TO_COUNTRY[cityKey] || CITY_TO_COUNTRY[cleaned];
  if (fromCity) return findCountryByEn(fromCity);

  // 「中国上海」「智利圣地亚哥」等：先按最长国名命中
  for (const m of countryMatchers()) {
    if (cleaned.includes(m.zh) || lower.includes(m.en)) return m.item;
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
    const noParen = stripNoise(part);
    const hit = resolveCountryItem(noParen) || resolveCountryItem(part);
    if (hit) return hit.zh;
  }

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

/** 筛选项：原始脏值列表 → 去重后的标准中文国名（排除未分类） */
export const uniqueNormalizedCountriesZh = (raws: Iterable<string | null | undefined>): string[] => {
  const set = new Set<string>();
  for (const raw of raws) {
    const zh = normalizeCountryZh(raw);
    if (zh && zh !== '未分类') set.add(zh);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
};

/** 记录国家是否匹配筛选项（筛选项可为中/英；两侧都归一后再比） */
export const countryMatchesFilter = (
  raw: string | null | undefined,
  filterZh: string
): boolean => {
  if (!filterZh || filterZh === 'all') return true;
  const a = normalizeCountryZh(raw);
  const b = normalizeCountryZh(filterZh);
  if (a === '未分类' || b === '未分类') return false;
  return a === b;
};

/** 把可识别的脏国名改成标准中文；无法识别则保留原文（避免误伤自定义值） */
export const canonicalizeCountryField = (raw?: string | null): string => {
  if (!raw || !String(raw).trim()) return '';
  const zh = normalizeCountryZh(raw);
  if (zh === '未分类') return String(raw).trim();
  return zh;
};
