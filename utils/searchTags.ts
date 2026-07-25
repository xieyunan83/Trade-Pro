import { ClientSearchResult } from '../types';

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

  return results.map((r) => {
    const countryTag = (r.country || targetCountry || '').trim();
    const tags = [
      keyword ? `关键词:${keyword}` : '',
      countryTag ? `国家:${countryTag}` : '',
      ...types.map((t) => `类型:${t}`),
      r.clientType ? `客户类型:${r.clientType}` : '',
    ].filter(Boolean);
    // 去重
    const unique = Array.from(new Set(tags));

    return {
      ...r,
      searchKeyword: keyword || r.searchKeyword,
      searchCountry: targetCountry || r.country || r.searchCountry,
      searchTags: unique.length ? unique : r.searchTags,
      searchId: opts.searchId,
      country: r.country || targetCountry,
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
