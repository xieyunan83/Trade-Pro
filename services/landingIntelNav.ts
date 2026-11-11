/**
 * 今日看板 · 精选公开情报入口（纯静态，零网络请求）
 * 仅作外链导航，不抓取、不预取、不嵌入第三方页。
 */

export type IntelNavCategory = 'trend' | 'macro' | 'verify' | 'demand';

export type IntelNavItem = {
  id: string;
  /** 前台中性名称 */
  label: string;
  /** 一行用途说明 */
  blurb: string;
  /** 控制台短码，仅作视觉层级 */
  code: string;
  href: string;
  category: IntelNavCategory;
};

export const INTEL_NAV_CATEGORIES: {
  id: IntelNavCategory;
  title: string;
  sub: string;
  channel: string;
}[] = [
  { id: 'trend', title: '趋势热度', sub: '品类与关键词', channel: 'CH-01' },
  { id: 'macro', title: '贸易宏观', sub: '国别与进出口', channel: 'CH-02' },
  { id: 'verify', title: '主体核验', sub: '公开披露与登记', channel: 'CH-03' },
  { id: 'demand', title: '消费力', sub: '生活成本与市场', channel: 'CH-04' },
];

/** 首屏精选入口（控制数量，零请求） */
export const LANDING_INTEL_NAV: IntelNavItem[] = [
  {
    id: 'gtrends',
    label: '全球搜索热度',
    blurb: '目标国品类兴趣走势',
    code: 'HEAT',
    href: 'https://trends.google.com/trends/',
    category: 'trend',
  },
  {
    id: 'baidu-index',
    label: '国内品类热度',
    blurb: '中文关键词搜索热度',
    code: 'IDX',
    href: 'https://index.baidu.com/',
    category: 'trend',
  },
  {
    id: 'similarweb',
    label: '站点流量画像',
    blurb: '客户站访问量级快估',
    code: 'FLOW',
    href: 'https://www.similarweb.com/',
    category: 'trend',
  },
  {
    id: 'worldbank',
    label: '世界银行数据',
    blurb: '国别宏观与贸易指标',
    code: 'WB',
    href: 'https://data.worldbank.org/',
    category: 'macro',
  },
  {
    id: 'cn-stats',
    label: '中国国家数据',
    blurb: '官方统计与开放数据',
    code: 'CNS',
    href: 'https://data.stats.gov.cn/',
    category: 'macro',
  },
  {
    id: 'oec',
    label: '全球贸易图谱',
    blurb: '进出口结构可视化',
    code: 'OEC',
    href: 'https://oec.world/',
    category: 'macro',
  },
  {
    id: 'sec-edgar',
    label: '美股公司披露',
    blurb: '上市主体公开文件',
    code: 'SEC',
    href: 'https://www.sec.gov/edgar/search/',
    category: 'verify',
  },
  {
    id: 'gsxt',
    label: '企业主体核验',
    blurb: '国内登记信息查询',
    code: 'GSXT',
    href: 'https://www.gsxt.gov.cn/',
    category: 'verify',
  },
  {
    id: 'numbeo',
    label: '生活成本指数',
    blurb: '目标城市消费力参考',
    code: 'COL',
    href: 'https://www.numbeo.com/cost-of-living/',
    category: 'demand',
  },
];
