/**
 * 客户搜索 — 多源线索查询构造（黄页/目录/展会等）
 * 仅生成检索 query 与证据提示，不改动下游过滤与背调逻辑。
 */

export type LeadSearchInput = {
  productKeyword: string;
  country?: string;
  industry?: string;
  clientType?: string;
};

/** 全球通用 B2B 目录 / 黄页（公开可检索） */
const GLOBAL_DIRECTORIES = [
  'europages.com',
  'kompass.com',
  'thomasnet.com',
  'wlw.de',
  'exporters.alibaba.com',
  'tradekey.com',
];

/** 按市场补充的本地目录 / 协会 / 黄页域名 */
const MARKET_DIRECTORY_HINTS: Array<{ match: RegExp; sites: string[] }> = [
  {
    match: /united\s*states|usa|u\.s\.a|美国|canada|加拿大/i,
    sites: ['thomasnet.com', 'bbb.org', 'yellowpages.com', 'kompass.com'],
  },
  {
    match: /united\s*kingdom|uk|britain|英国|england/i,
    sites: ['yell.com', 'kompass.com', 'europages.com', 'companieshouse.gov.uk'],
  },
  {
    match: /germany|deutschland|德国|austria|奥地利|switzerland|瑞士/i,
    sites: ['wlw.de', 'gelbeseiten.de', 'europages.com', 'kompass.com'],
  },
  {
    match: /france|法国|belgium|比利时|netherlands|holland|荷兰|luxembourg/i,
    sites: ['europages.com', 'kompass.com', 'pagesjaunes.fr', 'bedrijvenlijst.nl'],
  },
  {
    match: /poland|波兰|czech|捷克|hungary|匈牙利|romania|罗马尼亚/i,
    sites: ['europages.com', 'kompass.com', 'panoramafirm.pl'],
  },
  {
    match: /spain|西班牙|portugal|葡萄牙|italy|意大利/i,
    sites: ['europages.com', 'kompass.com', 'paginegialle.it', 'paginasamarillas.es'],
  },
  {
    match: /australia|澳大利亚|new\s*zealand|新西兰/i,
    sites: ['yellowpages.com.au', 'trademe.co.nz', 'kompass.com'],
  },
  {
    match: /japan|日本/i,
    sites: ['jp.kompass.com', 'europages.com', 'jetro.go.jp'],
  },
  {
    match: /korea|韩国|south\s*korea/i,
    sites: ['kompass.com', 'europages.com', 'buykorea.org'],
  },
  {
    match: /singapore|新加坡|malaysia|马来|thailand|泰国|vietnam|越南|indonesia|印尼/i,
    sites: ['kompass.com', 'europages.com', 'yellowpages.com.sg'],
  },
  {
    match: /uae|dubai|阿联酋|saudi|沙特|middle\s*east|中东/i,
    sites: ['kompass.com', 'yellowpages.ae', 'europages.com'],
  },
  {
    match: /mexico|墨西哥|brazil|巴西|chile|智利|argentina|阿根廷|latin|拉美/i,
    sites: ['kompass.com', 'europages.com', 'paginasamarillas.com.mx'],
  },
  {
    match: /india|印度/i,
    sites: ['indiamart.com', 'tradeindia.com', 'kompass.com'],
  },
];

const normalize = (s?: string) => (s || '').replace(/\s+/g, ' ').trim();

const isVague = (c?: string) =>
  !c?.trim() || /^(global|worldwide|international|国际|全球|不限)$/i.test(c.trim());

/** 解析目标市场对应的目录域名（去重，最多 4 个） */
export const resolveDirectorySitesForMarket = (country?: string): string[] => {
  const c = normalize(country);
  const out: string[] = [];
  const push = (site: string) => {
    const s = site.toLowerCase();
    if (!out.includes(s)) out.push(s);
  };

  if (!isVague(c)) {
    for (const row of MARKET_DIRECTORY_HINTS) {
      if (row.match.test(c)) {
        row.sites.forEach(push);
        break;
      }
    }
  }
  // 全球兜底
  GLOBAL_DIRECTORIES.forEach(push);
  return out.slice(0, 4);
};

/**
 * 构造多源获客查询（开放网页 + 目录站 + 展会/协会）
 * 上层可 slice 控制调用次数，避免打爆额度。
 */
export const buildLeadDiscoveryQueries = (opts: LeadSearchInput): string[] => {
  const kw = normalize(opts.productKeyword);
  if (!kw) return [];
  const country = normalize(opts.country);
  const industry = normalize(opts.industry);
  const ctype = normalize(opts.clientType) || 'importer OR distributor OR wholesaler OR retailer';
  const market = isVague(country) ? '' : country;
  const dirs = resolveDirectorySitesForMarket(market);

  const queries: string[] = [];
  const add = (q: string) => {
    const t = normalize(q);
    if (!t || queries.includes(t)) return;
    queries.push(t);
  };

  // 1) 开放网页买家检索
  add(`${kw} ${ctype} ${market} company website`.trim());
  add(`${kw} (buyer OR importer OR distributor OR wholesaler) ${market}`.trim());
  if (industry) add(`${industry} ${kw} ${market} wholesale OR import`.trim());

  // 2) 目录 / 黄页站点（site:）
  if (dirs[0]) add(`site:${dirs[0]} ${kw} ${market}`.trim());
  if (dirs[1]) add(`site:${dirs[1]} ${kw} ${market || 'distributor'}`.trim());
  // 组合目录域名（不带 site，便于搜索引擎命中列表页）
  add(`${kw} ${market} (europages OR kompass OR thomasnet OR "yellow pages" OR directory)`.trim());

  // 3) 展会 / 协会 / 会员名录
  add(`${kw} ${market} (exhibition OR trade show OR fair OR association OR "member list" OR 展会 OR 协会) importer OR buyer`.trim());

  // 4) B2B 采购向补充
  add(`"${kw}" ${market} "looking for suppliers" OR procurement OR sourcing OR "import from china"`.trim());

  return queries;
};

/** 给模型的证据使用说明（追加在 prompt 末尾） */
export const LEAD_EVIDENCE_USAGE_HINT = `
MULTI-SOURCE EXTRACTION RULES (when directory / exhibition / yellow-page evidence is present):
1) Prefer real company names + official websites extracted from directory listings, association member lists, and trade-show exhibitor pages.
2) A directory page that lists multiple companies can yield MULTIPLE leads — extract as many distinct buyers as the evidence supports (up to the ask limit).
3) Skip marketplace seller pages that are clearly Chinese exporters only (Alibaba storefronts of Chinese factories) unless they are overseas importers/distributors.
4) Still enforce TARGET MARKET + PRODUCT fit. Do not invent domains.
`.trim();
