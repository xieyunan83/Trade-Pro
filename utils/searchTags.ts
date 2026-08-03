import { ClientSearchResult } from '../types';

/** Global / 全球等非具体国家：不能盖住结果里的真实国家 */
const isNonSpecificCountry = (c?: string) =>
  !c?.trim() || /^(global|worldwide|international|国际|全球|不限)$/i.test(c.trim());

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
    const unique = Array.from(new Set(tags));

    return {
      ...r,
      searchKeyword: keyword || r.searchKeyword,
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
