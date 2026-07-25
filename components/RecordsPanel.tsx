import React, { useEffect, useMemo, useState } from 'react';
import { HistoryItem, DiscoveryArchiveItem, DiscoveryState } from '../types';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FolderOpen,
  Globe,
  Search,
  Trash2,
  Building2,
  Plus,
  Pencil,
  Tag,
} from 'lucide-react';
import { normalizeCountryZh } from '../utils/countryNormalize';
import {
  getCustomKeywords,
  getCustomCountries,
  addCustomKeyword,
  addCustomCountry,
  renameCustomKeyword,
  renameCustomCountry,
  removeCustomKeyword,
  removeCustomCountry,
  mergeObservedKeywords,
  mergeObservedCountries,
} from '../services/taxonomyStore';

type RecordTab = 'search' | 'background' | 'all';
type GroupBy = 'keyword' | 'country' | 'time';

interface RecordsPanelProps {
  history: HistoryItem[];
  discoveryArchives: DiscoveryArchiveItem[];
  onClose: () => void;
  onOpenHistory: (item: HistoryItem) => void;
  onDownloadHistory: (item: HistoryItem) => void;
  onRestoreDiscovery: (archive: DiscoveryArchiveItem) => void;
  onDeleteHistory?: (id: string) => void;
  onDeleteDiscovery?: (id: string) => void;
  /** 更新背调记录的关键词/国家 */
  onPatchHistory?: (id: string, patch: Partial<Pick<HistoryItem, 'keyword' | 'country'>>) => void;
  /** 批量更新 */
  onBulkPatchHistory?: (ids: string[], patch: Partial<Pick<HistoryItem, 'keyword' | 'country'>>) => void;
}

const UNCATEGORIZED = '未分类';

const timeKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const discoveryKeyword = (d: DiscoveryArchiveItem) => (d.product || '').trim() || UNCATEGORIZED;

const discoveryCountries = (d: DiscoveryArchiveItem): string[] => {
  const raws: string[] = [];
  if (d.countries?.length) raws.push(...d.countries);
  else if (d.country) raws.push(...d.country.split(/[,，;/|]+/));
  else (d.results || []).forEach((r) => raws.push(r.searchCountry || r.country || ''));
  const normalized = Array.from(new Set(raws.map((c) => normalizeCountryZh(c)).filter((c) => c && c !== UNCATEGORIZED)));
  return normalized.length ? normalized : [UNCATEGORIZED];
};

const historyKeyword = (h: HistoryItem) => (h.keyword || '').trim() || UNCATEGORIZED;

const historyCountry = (h: HistoryItem) =>
  normalizeCountryZh(h.country || h.data?.companyInfo?.headquarters || h.data?.companyInfo?.city || '');

export const RecordsPanel: React.FC<RecordsPanelProps> = ({
  history,
  discoveryArchives,
  onClose,
  onOpenHistory,
  onDownloadHistory,
  onRestoreDiscovery,
  onDeleteHistory,
  onDeleteDiscovery,
  onPatchHistory,
  onBulkPatchHistory,
}) => {
  const [tab, setTab] = useState<RecordTab>('background');
  const [groupBy, setGroupBy] = useState<GroupBy>('keyword');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [expandInitKey, setExpandInitKey] = useState('');
  const [keywords, setKeywords] = useState<string[]>(() => getCustomKeywords());
  const [countries, setCountries] = useState<string[]>(() => getCustomCountries());
  const [manageOpen, setManageOpen] = useState(false);

  // 启动时把已有记录里的词合并进自定义列表
  useEffect(() => {
    const obsKw = history.map(historyKeyword).concat(discoveryArchives.map(discoveryKeyword));
    const obsCo = history.map(historyCountry).concat(discoveryArchives.flatMap(discoveryCountries));
    setKeywords(mergeObservedKeywords(obsKw));
    setCountries(mergeObservedCountries(obsCo));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  type Row =
    | { kind: 'history'; item: HistoryItem }
    | { kind: 'discovery'; item: DiscoveryArchiveItem };

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hist: Row[] = history
      .filter((h) => tab === 'all' || tab === 'background')
      .filter((h) => {
        if (!q) return true;
        const blob = [h.keyword, h.country, h.domain, h.data?.companyInfo?.name].filter(Boolean).join(' ').toLowerCase();
        return blob.includes(q);
      })
      .map((item) => ({ kind: 'history' as const, item }));

    const disc: Row[] = discoveryArchives
      .filter(() => tab === 'all' || tab === 'search')
      .filter((d) => {
        if (!q) return true;
        const blob = [d.product, d.country, ...(d.countries || [])].filter(Boolean).join(' ').toLowerCase();
        return blob.includes(q);
      })
      .map((item) => ({ kind: 'discovery' as const, item }));

    return [...disc, ...hist];
  }, [history, discoveryArchives, tab, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    const push = (key: string, row: Row) => {
      const k = key || UNCATEGORIZED;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(row);
    };
    for (const row of rows) {
      if (groupBy === 'keyword') {
        push(row.kind === 'history' ? historyKeyword(row.item) : discoveryKeyword(row.item), row);
      } else if (groupBy === 'country') {
        if (row.kind === 'history') push(historyCountry(row.item), row);
        else discoveryCountries(row.item).forEach((c) => push(c, row));
      } else {
        push(timeKey(row.kind === 'history' ? row.item.timestamp : row.item.timestamp), row);
      }
    }
    return Array.from(map.entries())
      .map(([key, items]) => ({ key, items }))
      .sort((a, b) => {
        if (groupBy === 'time') return b.key.localeCompare(a.key);
        if (a.key === UNCATEGORIZED) return 1;
        if (b.key === UNCATEGORIZED) return -1;
        return a.key.localeCompare(b.key, 'zh');
      });
  }, [rows, groupBy]);

  useEffect(() => {
    const sig = `${tab}|${groupBy}|${groups.map((g) => g.key).join(',')}`;
    if (sig === expandInitKey) return;
    setExpandInitKey(sig);
    setExpanded(new Set(groups.map((g) => g.key)));
  }, [tab, groupBy, groups, expandInitKey]);

  const handleAddTaxonomy = () => {
    const name = prompt(groupBy === 'country' ? '新增国家名称（建议中文，如：波兰）' : '新增关键词（如：Car toy）');
    if (!name?.trim()) return;
    if (groupBy === 'country') setCountries(addCustomCountry(name));
    else setKeywords(addCustomKeyword(name));
  };

  const handleRenameGroup = (from: string) => {
    if (from === UNCATEGORIZED || groupBy === 'time') return;
    const to = prompt(groupBy === 'country' ? `重命名国家「${from}」为：` : `重命名关键词「${from}」为：`, from);
    if (!to?.trim() || to.trim() === from) return;
    const next = to.trim();
    if (groupBy === 'keyword') {
      setKeywords(renameCustomKeyword(from, next));
      const ids = groups
        .find((g) => g.key === from)
        ?.items.filter((r) => r.kind === 'history')
        .map((r) => (r as { kind: 'history'; item: HistoryItem }).item.id);
      if (ids?.length && onBulkPatchHistory) onBulkPatchHistory(ids, { keyword: next });
    } else {
      setCountries(renameCustomCountry(from, next));
      const ids = groups
        .find((g) => g.key === from)
        ?.items.filter((r) => r.kind === 'history')
        .map((r) => (r as { kind: 'history'; item: HistoryItem }).item.id);
      if (ids?.length && onBulkPatchHistory) onBulkPatchHistory(ids, { country: next });
    }
  };

  const handleDeleteGroup = (name: string) => {
    if (name === UNCATEGORIZED || groupBy === 'time') return;
    if (!confirm(`删除分类「${name}」？该分类下的背调记录将变为「未分类」。`)) return;
    const ids = groups
      .find((g) => g.key === name)
      ?.items.filter((r) => r.kind === 'history')
      .map((r) => (r as { kind: 'history'; item: HistoryItem }).item.id);
    if (groupBy === 'keyword') {
      setKeywords(removeCustomKeyword(name));
      if (ids?.length && onBulkPatchHistory) onBulkPatchHistory(ids, { keyword: '' });
    } else {
      setCountries(removeCustomCountry(name));
      if (ids?.length && onBulkPatchHistory) onBulkPatchHistory(ids, { country: '' });
    }
  };

  const handleAssignGroup = (fromKey: string) => {
    if (groupBy === 'time') return;
    const list = groupBy === 'keyword' ? keywords : countries;
    const options = list.filter((x) => x !== fromKey);
    const hint =
      groupBy === 'keyword'
        ? `将「${fromKey}」下的背调全部归到哪个关键词？\n可选：${options.join(' / ') || '（请先新增关键词）'}`
        : `将「${fromKey}」下的背调全部归到哪个国家？\n可选：${options.join(' / ') || '（请先新增国家）'}`;
    const to = prompt(hint, options[0] || (groupBy === 'keyword' ? 'Car toy' : '波兰'));
    if (!to?.trim()) return;
    const next = to.trim();
    if (groupBy === 'keyword') {
      if (!keywords.includes(next)) setKeywords(addCustomKeyword(next));
      const ids = groups
        .find((g) => g.key === fromKey)
        ?.items.filter((r) => r.kind === 'history')
        .map((r) => (r as { kind: 'history'; item: HistoryItem }).item.id);
      if (ids?.length && onBulkPatchHistory) onBulkPatchHistory(ids, { keyword: next });
    } else {
      if (!countries.includes(next)) setCountries(addCustomCountry(next));
      const ids = groups
        .find((g) => g.key === fromKey)
        ?.items.filter((r) => r.kind === 'history')
        .map((r) => (r as { kind: 'history'; item: HistoryItem }).item.id);
      if (ids?.length && onBulkPatchHistory) onBulkPatchHistory(ids, { country: next });
    }
  };

  const taxonomyList = groupBy === 'keyword' ? keywords : groupBy === 'country' ? countries : [];

  return (
    <div className="fixed inset-y-0 left-0 md:left-72 w-full sm:w-[min(100vw,28rem)] md:w-96 lg:w-[28rem] max-w-full bg-white shadow-2xl z-50 border-r border-slate-200 flex flex-col animate-fade-in safe-area-inset">
      <div className="p-3 sm:p-4 border-b bg-slate-50 flex justify-between items-center gap-2">
        <div className="min-w-0">
          <div className="font-black text-slate-800 text-sm flex items-center gap-2">
            <FolderOpen size={16} className="text-blue-600 flex-shrink-0" /> 记录中心
          </div>
          <div className="text-[10px] text-slate-400 font-bold mt-0.5 truncate">自定义分类 · 可增删改</div>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg px-2 touch-manipulation">
          ✕
        </button>
      </div>

      <div className="p-2 border-b border-slate-100 flex gap-1">
        {(
          [
            { id: 'search' as const, label: '搜索', count: discoveryArchives.length },
            { id: 'background' as const, label: '背调', count: history.length },
            { id: 'all' as const, label: '全部', count: discoveryArchives.length + history.length },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 px-2 py-2.5 rounded-xl text-[11px] font-black touch-manipulation ${
              tab === t.id ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600'
            }`}
          >
            {t.label} {t.count}
          </button>
        ))}
      </div>

      <div className="px-2 py-2 border-b border-slate-100 flex gap-1">
        {(
          [
            { id: 'keyword' as const, label: '关键词' },
            { id: 'country' as const, label: '国家' },
            { id: 'time' as const, label: '时间' },
          ] as const
        ).map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGroupBy(g.id)}
            className={`flex-1 px-2 py-2 rounded-lg text-[10px] font-black touch-manipulation ${
              groupBy === g.id ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'text-slate-500'
            }`}
          >
            按{g.label}
          </button>
        ))}
      </div>

      {/* 自定义分类管理 */}
      {(groupBy === 'keyword' || groupBy === 'country') && (
        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/80 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wide flex items-center gap-1">
              <Tag size={12} /> {groupBy === 'keyword' ? '我的关键词' : '我的国家'}（可自定义）
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={handleAddTaxonomy}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black touch-manipulation"
              >
                <Plus size={12} /> 新增
              </button>
              <button
                type="button"
                onClick={() => setManageOpen((v) => !v)}
                className="px-2 py-1.5 rounded-lg border border-slate-200 text-[10px] font-black text-slate-600 touch-manipulation"
              >
                {manageOpen ? '收起' : '管理'}
              </button>
            </div>
          </div>
          {manageOpen && (
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {taxonomyList.length === 0 && (
                <span className="text-[10px] text-slate-400 font-bold">暂无，请点击「新增」</span>
              )}
              {taxonomyList.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-black text-slate-700"
                >
                  {name}
                  <button
                    type="button"
                    title="重命名"
                    className="text-blue-500 touch-manipulation"
                    onClick={() => handleRenameGroup(name)}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    title="删除"
                    className="text-red-400 touch-manipulation"
                    onClick={() => handleDeleteGroup(name)}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="px-3 py-2 border-b border-slate-100 flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (expanded.size >= groups.length) setExpanded(new Set());
            else setExpanded(new Set(groups.map((g) => g.key)));
          }}
          className="px-2 py-2 rounded-xl border border-slate-200 text-[10px] font-black text-slate-500 touch-manipulation whitespace-nowrap"
        >
          {expanded.size >= groups.length ? '全部收起' : '全部展开'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar overscroll-contain">
        {groups.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-sm font-bold">暂无记录</div>
        ) : (
          groups.map((g) => {
            const open = expanded.has(g.key);
            return (
              <div key={`${groupBy}-${g.key}`} className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="flex items-stretch bg-slate-50">
                  <button
                    type="button"
                    onClick={() => toggle(g.key)}
                    className="flex-1 flex items-center gap-2 px-3 py-3 text-left touch-manipulation min-h-[44px]"
                  >
                    {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                    <span className="flex-1 font-black text-slate-700 text-xs truncate">{g.key}</span>
                    <span className="text-[10px] font-black text-slate-400 bg-white px-2 py-0.5 rounded-lg border">{g.items.length}</span>
                  </button>
                  {(groupBy === 'keyword' || groupBy === 'country') && (
                    <div className="flex items-center gap-0.5 pr-1">
                      <button
                        type="button"
                        title="归类到…"
                        onClick={() => handleAssignGroup(g.key)}
                        className="p-2 text-emerald-600 touch-manipulation"
                      >
                        <Tag size={14} />
                      </button>
                      {g.key !== UNCATEGORIZED && (
                        <>
                          <button type="button" title="重命名" onClick={() => handleRenameGroup(g.key)} className="p-2 text-blue-600 touch-manipulation">
                            <Pencil size={14} />
                          </button>
                          <button type="button" title="删除分类" onClick={() => handleDeleteGroup(g.key)} className="p-2 text-red-400 touch-manipulation">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {open && (
                  <div className="divide-y divide-slate-50">
                    {g.items.map((row) =>
                      row.kind === 'history' ? (
                        <div key={`h-${row.item.id}`} className="p-3 hover:bg-blue-50/60" onClick={() => onOpenHistory(row.item)}>
                          <div className="flex items-start gap-2">
                            <Building2 size={14} className="text-blue-500 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-black text-slate-800 truncate">{row.item.data?.companyInfo?.name || row.item.domain}</div>
                              <div className="text-[10px] text-slate-400 truncate">{row.item.domain}</div>
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                <span className="text-[9px] font-black bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded">背调</span>
                                <span className="text-[9px] font-black bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                                  {historyKeyword(row.item)}
                                </span>
                                <span className="text-[9px] font-black bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded">
                                  {historyCountry(row.item)}
                                </span>
                              </div>
                              {/* 单条改关键词/国家 */}
                              {onPatchHistory && (
                                <div className="flex flex-wrap gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                                  <select
                                    className="text-[10px] font-bold border rounded-lg px-1 py-1 bg-white max-w-[45%]"
                                    value={row.item.keyword || ''}
                                    onChange={(e) => onPatchHistory(row.item.id, { keyword: e.target.value })}
                                  >
                                    <option value="">关键词:未分类</option>
                                    {keywords.map((k) => (
                                      <option key={k} value={k}>
                                        {k}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    className="text-[10px] font-bold border rounded-lg px-1 py-1 bg-white max-w-[45%]"
                                    value={row.item.country || ''}
                                    onChange={(e) => onPatchHistory(row.item.id, { country: e.target.value })}
                                  >
                                    <option value="">国家:未分类</option>
                                    {countries.map((c) => (
                                      <option key={c} value={c}>
                                        {c}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 mt-2">
                            <button
                              type="button"
                              className="text-[10px] font-black text-blue-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDownloadHistory(row.item);
                              }}
                            >
                              <Download size={11} className="inline" /> PPT
                            </button>
                            {onDeleteHistory && (
                              <button
                                type="button"
                                className="text-red-400"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm('删除？')) onDeleteHistory(row.item.id);
                                }}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div key={`d-${row.item.id}`} className="p-3 hover:bg-emerald-50/60" onClick={() => onRestoreDiscovery(row.item)}>
                          <div className="flex items-start gap-2">
                            <Globe size={14} className="text-emerald-500 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-black truncate">{row.item.product || '搜索'}</div>
                              <div className="text-[10px] text-slate-400">{row.item.results?.length || 0} 家客户</div>
                            </div>
                          </div>
                          {onDeleteDiscovery && (
                            <div className="flex justify-end mt-2">
                              <button
                                type="button"
                                className="text-red-400"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm('删除？')) onDeleteDiscovery(row.item.id);
                                }}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export const archiveToDiscoveryState = (a: DiscoveryArchiveItem): DiscoveryState => ({
  product: a.product || '',
  country: a.country || (a.countries || []).join(', '),
  countries: a.countries || [],
  industry: a.industry || '',
  clientType: a.clientType || (a.clientTypes || []).join(', '),
  clientTypes: a.clientTypes || [],
  results: a.results || [],
  hasSearched: true,
});
