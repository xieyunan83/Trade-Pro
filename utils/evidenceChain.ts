import type { AnalysisResult, EvidenceItem } from '../types';

const URL_RE = /https?:\/\/[^\s<>"'）】\]]+/gi;

const cleanUrl = (raw: string): string =>
  (raw || '')
    .trim()
    .replace(/[),.;，。]+$/g, '')
    .replace(/[?#].*$/, (m) => (m.startsWith('?') || m.startsWith('#') ? '' : m));

export const parseEvidenceItemsFromText = (
  text: string,
  source: EvidenceItem['source'] = 'other'
): EvidenceItem[] => {
  if (!text?.trim()) return [];
  const found = text.match(URL_RE) || [];
  const items: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    const url = cleanUrl(raw);
    if (!url || seen.has(url)) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    seen.add(url);
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./i, '');
    } catch {
      /* keep */
    }
    items.push({
      title: host,
      url,
      source,
      confidence: source === 'official' ? 0.9 : source === 'tavily' || source === 'anysearch' ? 0.75 : 0.6,
    });
  }
  return items;
};

export const evidenceItemsFromTavilyResults = (
  results: Array<{ title?: string; url?: string; content?: string; score?: number }> | undefined
): EvidenceItem[] => {
  if (!results?.length) return [];
  const items: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const url = cleanUrl(r.url || '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({
      title: (r.title || '').trim() || url,
      url,
      source: 'tavily',
      snippet: (r.content || '').trim().slice(0, 180),
      confidence: typeof r.score === 'number' ? Math.min(0.95, Math.max(0.4, r.score)) : 0.75,
    });
  }
  return items;
};

export const mergeEvidenceItems = (...lists: EvidenceItem[][]): EvidenceItem[] => {
  const map = new Map<string, EvidenceItem>();
  for (const list of lists) {
    for (const item of list) {
      const key = cleanUrl(item.url).toLowerCase();
      if (!key) continue;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...item, url: cleanUrl(item.url) });
        continue;
      }
      map.set(key, {
        ...prev,
        title: prev.title.length >= item.title.length ? prev.title : item.title,
        snippet: prev.snippet || item.snippet,
        confidence: Math.max(prev.confidence || 0, item.confidence || 0),
        source: prev.source === 'official' ? prev.source : item.source,
      });
    }
  }
  return [...map.values()].slice(0, 24);
};

export const buildFallbackEvidenceFromReport = (data: AnalysisResult): EvidenceItem[] => {
  const items: EvidenceItem[] = [];
  const site = (data.companyInfo?.website || '').trim();
  if (site && site !== 'N/A') {
    const url = /^https?:\/\//i.test(site) ? site : `https://${site}`;
    items.push({ title: '官方网站', url, source: 'official', confidence: 0.9 });
  }
  const socials = data.socials || {};
  for (const [label, raw] of Object.entries(socials)) {
    const v = (raw || '').trim();
    if (!v || !/^https?:\/\//i.test(v)) continue;
    items.push({
      title: `社媒 · ${label}`,
      url: v,
      source: 'social',
      confidence: 0.7,
    });
  }
  const li = data.tradeIntelligence?.companyLinkedin?.trim();
  if (li && /^https?:\/\//i.test(li)) {
    items.push({ title: '公司 LinkedIn', url: li, source: 'social', confidence: 0.75 });
  }
  return mergeEvidenceItems(items);
};

/** 根据证据数量与关键字段粗估报告可信度 */
export const scoreEvidenceConfidence = (
  data: AnalysisResult,
  items: EvidenceItem[]
): number => {
  let score = 0.25;
  if (items.length >= 2) score += 0.15;
  if (items.length >= 5) score += 0.1;
  if (items.some((i) => i.source === 'official')) score += 0.1;
  if (items.some((i) => i.source === 'tavily' || i.source === 'anysearch')) score += 0.1;

  const hq = (data.companyInfo?.headquarters || '').trim();
  if (hq && !/公开信息|未找到|待核实|N\/A/i.test(hq)) score += 0.12;

  const dms = data.decisionMakers || [];
  if (dms.some((d) => (d.emailGuess || '').includes('@') || (d.phone || '').trim())) score += 0.1;

  const trade = data.tradeIntelligence;
  if (trade?.customsSummary && !/公开信息未找到/.test(trade.customsSummary)) score += 0.08;

  return Math.min(0.95, Math.round(score * 100) / 100);
};

export const summarizeEvidence = (items: EvidenceItem[], confidence: number): string => {
  if (!items.length) {
    return '暂无结构化证据链接。建议再次背调以采集官网/检索来源；当前结论请人工复核。';
  }
  const pct = Math.round(confidence * 100);
  const hosts = [...new Set(items.map((i) => {
    try {
      return new URL(i.url).hostname.replace(/^www\./i, '');
    } catch {
      return i.title;
    }
  }))].slice(0, 4);
  return `共 ${items.length} 条公开来源（约 ${pct}% 可信度粗估），主要来自：${hosts.join('、')}。关键事实请点开链接核对。`;
};
