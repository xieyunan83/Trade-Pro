import { ClientSearchResult, DiscoveryArchiveItem } from '../types';

/** Global / 全球等非具体国家：不能盖住结果里的真实国家 */
const isNonSpecificCountry = (c?: string) =>
  !c?.trim() || /^(global|worldwide|international|国际|全球|不限)$/i.test(c.trim());

const normalizeHost = (url?: string) =>
  (url || '')
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .toLowerCase();

const extractKeywordFromTag = (tag: string) => {
  const m = tag.match(/^关键词:(.+)$/);
  return m ? m[1].trim() : '';
};

/** 为搜索结果打上来源标签（关键词 / 国家 / 类型） */
export const stampSearchResults = (
  results: ClientSearchResult[],
  opts: {
    keyword: string;
    targetCountry: string;
    clientTypes?: string[];
    searchId: string;
  }
): ClientSearchResult[] => {
  const keyword = (opts.keyword || '').trim();
  const targetCountry = (opts.targetCountry || '').trim();
  const types = (opts.clientTypes || []).filter(Boolean);
  const specificTarget = isNonSpecificCountry(targetCountry) ? '' : targetCountry;

  return results.map((r) => {
    // Prefer the company's own country from search; never stamp "Global" over Poland etc.
    const companyCountry = (r.country || '').trim();
    // 有明确目标国时：标签国家优先用目标国；公司国仅在与目标一致时用于展示
    const matchedCompany =
      specificTarget && companyCountry && !isNonSpecificCountry(companyCountry)
        ? companyCountry
        : '';
    const displayCountry = specificTarget
      ? matchedCompany || specificTarget
      : companyCountry || specificTarget || '';
    const countryTag = (displayCountry || '').trim();
    const tags = [
      keyword ? `关键词:${keyword}` : '',
      countryTag ? `国家:${countryTag}` : '',
      ...types.map((t) => `类型:${t}`),
      r.clientType ? `客户类型:${r.clientType}` : '',
    ].filter(Boolean);
    // 去重
    const unique = Array.from(new Set([...(r.searchTags || []), ...tags]));
    const searchedKeywords = Array.from(
      new Set([...(r.searchedKeywords || []), keyword, r.searchKeyword].filter(Boolean) as string[])
    );

    return {
      ...r,
      searchKeyword: keyword || r.searchKeyword,
      searchedKeywords,
      // 搜索目标市场：有具体目标国则固定为目标国，避免被模型乱填其它国家污染后续背调
      searchCountry: specificTarget || companyCountry || r.searchCountry || undefined,
      searchTags: unique.length ? unique : r.searchTags,
      searchId: opts.searchId,
      country: displayCountry || r.country,
    };
  });
};

export const buildSearchTags = (keyword: string, country: string, extra: string[] = []): string[] => {
  const tags = [
    keyword ? `关键词:${keyword.trim()}` : '',
    country ? `国家:${country.trim()}` : '',
    ...extra,
  ].filter(Boolean);
  return Array.from(new Set(tags));
};

/**
 * 合并同域名结果，并叠加历史归档中已搜索过的关键词标签，避免重复背调。
 */
export const mergeResultsWithPriorKeywords = (
  results: ClientSearchResult[],
  archives: DiscoveryArchiveItem[] = [],
  opts?: { excludeArchiveId?: string }
): ClientSearchResult[] => {
  const priorByHost = new Map<string, Set<string>>();
  for (const arch of archives) {
    if (opts?.excludeArchiveId && arch.id === opts.excludeArchiveId) continue;
    const kw = (arch.product || '').trim();
    for (const r of arch.results || []) {
      const host = normalizeHost(r.website);
      if (!host) continue;
      if (!priorByHost.has(host)) priorByHost.set(host, new Set());
      const set = priorByHost.get(host)!;
      if (kw) set.add(kw);
      if (r.searchKeyword) set.add(r.searchKeyword.trim());
      for (const t of r.searchTags || []) {
        const ek = extractKeywordFromTag(t);
        if (ek) set.add(ek);
      }
      for (const k of r.searchedKeywords || []) {
        if (k?.trim()) set.add(k.trim());
      }
    }
  }

  const byHost = new Map<string, ClientSearchResult>();
  const noHost: ClientSearchResult[] = [];

  for (const r of results) {
    const host = normalizeHost(r.website);
    if (!host) {
      noHost.push(r);
      continue;
    }
    const prior = priorByHost.get(host);
    const priorList = prior ? [...prior] : [];
    const currentKws = [
      ...(r.searchedKeywords || []),
      r.searchKeyword,
      ...(r.searchTags || []).map(extractKeywordFromTag),
    ]
      .map((s) => (s || '').trim())
      .filter(Boolean);
    const allKws = Array.from(new Set([...currentKws, ...priorList]));
    const previouslySearched = priorList.some((k) => k && k !== (r.searchKeyword || '').trim());

    const keywordTags = allKws.map((k) => `关键词:${k}`);
    const otherTags = (r.searchTags || []).filter((t) => !t.startsWith('关键词:'));
    const mergedTags = Array.from(new Set([...otherTags, ...keywordTags]));

    const existing = byHost.get(host);
    if (!existing) {
      byHost.set(host, {
        ...r,
        searchedKeywords: allKws,
        searchTags: mergedTags,
        previouslySearched: previouslySearched || allKws.length > 1,
      });
      continue;
    }

    // 同轮次多国结果：合并标签与关键词
    const mergedKws = Array.from(
      new Set([...(existing.searchedKeywords || []), ...allKws].filter(Boolean))
    );
    byHost.set(host, {
      ...existing,
      ...r,
      description: existing.description || r.description,
      fitScore: Math.max(existing.fitScore || 0, r.fitScore || 0) || r.fitScore,
      searchedKeywords: mergedKws,
      searchTags: Array.from(
        new Set([...(existing.searchTags || []), ...mergedTags, ...mergedKws.map((k) => `关键词:${k}`)])
      ),
      previouslySearched: true,
      searchKeyword: r.searchKeyword || existing.searchKeyword,
    });
  }

  return [...byHost.values(), ...noHost];
};
