import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Client, CRM_FUNNEL_STAGES, HistoryItem } from '../types';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  ExternalLink,
  Download,
  Tag,
  RefreshCw,
  CalendarClock,
  PackageSearch,
  Users,
} from 'lucide-react';
import {
  buildHistoryLookupIndex,
  clientHasBackgroundCheckIndexed,
  formatBackgroundCheckTime,
  historyHasDmSearch,
  lookupHistoryForClient,
  resolveBackgroundCheckAtIndexed,
} from '../utils/crmHistory';
import { exportClientsToExcel } from '../services/exportService';
import { IndustryMultiSelect } from './IndustryMultiSelect';
import { PaginationBar } from './PaginationBar';
import { hasRichProductCatalog } from '../services/productCatalog';

interface ModuleClientCRMProps {
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  onBatchAnalyze: (clients: Client[]) => Promise<void>;
  onBatchDelete?: (clients: Client[]) => void | Promise<void>;
  /** 单条删除（带云端同步 + 墓碑，避免登录复活） */
  onDeleteClient?: (client: Client) => void | Promise<void>;
  /** 批量决策人邮箱深挖（后台队列） */
  onBatchDmSearch?: (clients: Client[]) => void;
  onBatchProductDig?: (clients: Client[]) => void | Promise<void>;
  /** 手动清理 2026-06 前旧 CRM */
  onPurgeBeforeJune2026?: () => void | Promise<void>;
  /** 从 GitHub / Supabase / 背调历史恢复 CRM */
  onRecoverCrm?: () => void | Promise<void>;
  onReanalyze?: (client: Client) => void;
  history: HistoryItem[];
  onOpenHistory: (item: HistoryItem) => void;
  productDigBusy?: boolean;
  /** 当前筛选后的客户顺序（含可打开报告的），供报告页上一家/下一家 */
  onNavOrderChange?: (order: { clientId: string; historyId: string }[]) => void;
}

type EnrichedClient = {
  client: Client;
  historyItem?: HistoryItem;
  hasBg: boolean;
  hasProduct: boolean;
  hasDm: boolean;
  bgAt?: number;
  canOpenReport: boolean;
};

const PAGE_SIZE = 40;

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const isOverdueFollowUp = (client: Client) => {
  const d = (client.nextFollowUpDate || '').trim();
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return false;
  if (client.status === '已成交' || client.status === '流失/搁置') return false;
  return d.slice(0, 10) < todayYmd();
};

const funnelToneClass: Record<(typeof CRM_FUNNEL_STAGES)[number]['tone'], string> = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  amber: 'bg-amber-50 text-amber-800 border-amber-100',
  violet: 'bg-violet-50 text-violet-700 border-violet-100',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  red: 'bg-red-50 text-red-700 border-red-100',
};

function useDebouncedValue<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const KeywordTags = React.memo(({ client }: { client: Client }) => {
  const kws = useMemo(
    () =>
      Array.from(
        new Set(
          [
            client.searchKeyword,
            ...(client.searchedKeywords || []),
            ...(client.tags || [])
              .filter((t) => t.startsWith('关键词:'))
              .map((t) => t.replace(/^关键词:/, '')),
          ].filter(Boolean) as string[]
        )
      ).slice(0, 4),
    [client.searchKeyword, client.searchedKeywords, client.tags]
  );
  if (!kws.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {kws.map((k) => (
        <span
          key={k}
          className="inline-flex items-center gap-0.5 bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] font-black"
        >
          <Tag size={8} /> {k}
        </span>
      ))}
    </div>
  );
});
KeywordTags.displayName = 'KeywordTags';

const StageControls = React.memo(
  ({
    client,
    onPatch,
  }: {
    client: Client;
    onPatch: (id: string, patch: Partial<Client>) => void;
  }) => {
    const overdue = isOverdueFollowUp(client);
    return (
      <div className="flex flex-col gap-1.5 min-w-[140px]">
        <select
          value={client.status}
          onChange={(e) => onPatch(client.id, { status: e.target.value as Client['status'] })}
          className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold bg-white"
        >
          {CRM_FUNNEL_STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
          <CalendarClock size={11} className={overdue ? 'text-red-500' : ''} />
          <input
            type="date"
            value={(client.nextFollowUpDate || '').slice(0, 10)}
            onChange={(e) => onPatch(client.id, { nextFollowUpDate: e.target.value })}
            className={`flex-1 min-w-0 px-1.5 py-1 rounded-lg border text-[11px] font-bold ${
              overdue ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'
            }`}
          />
        </label>
      </div>
    );
  }
);
StageControls.displayName = 'StageControls';

const BgStatus = React.memo(
  ({
    hasBg,
    canOpen,
    timeLabel,
    onOpenReport,
    onReanalyze,
  }: {
    hasBg: boolean;
    canOpen: boolean;
    timeLabel: string;
    onOpenReport: () => void;
    onReanalyze: () => void;
  }) => {
    if (hasBg) {
      return (
        <div className="inline-flex flex-col items-start gap-0.5">
          <button
            type="button"
            onClick={onOpenReport}
            disabled={!canOpen}
            title={canOpen ? `查看背调资料${timeLabel ? `（${timeLabel}）` : ''}` : '已标记背调，但本地无报告'}
            className={`inline-flex items-center gap-1 ${
              canOpen
                ? 'text-green-600 hover:text-green-700 cursor-pointer'
                : 'text-green-500 cursor-default'
            }`}
          >
            <CheckCircle2 size={16} />
            <span className="md:hidden text-xs font-bold">已背调</span>
            {canOpen && <ExternalLink size={12} className="opacity-60" />}
          </button>
          {timeLabel && (
            <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">{timeLabel}</span>
          )}
          <button
            type="button"
            onClick={onReanalyze}
            className="inline-flex items-center gap-0.5 text-[10px] font-black text-amber-600 hover:text-amber-700 hover:underline"
          >
            <RefreshCw size={10} /> 再次背调
          </button>
        </div>
      );
    }
    return (
      <div className="inline-flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1 text-slate-300" title="未做背调">
          <AlertTriangle size={16} />
          <span className="md:hidden text-xs font-bold">未背调</span>
        </span>
        <button
          type="button"
          onClick={onReanalyze}
          className="inline-flex items-center gap-0.5 text-[10px] font-black text-blue-600 hover:underline"
        >
          <RefreshCw size={10} /> 去背调
        </button>
      </div>
    );
  }
);
BgStatus.displayName = 'BgStatus';

const IntelChips: React.FC<{ hasBg: boolean; hasProduct: boolean; hasDm: boolean }> = ({
  hasBg,
  hasProduct,
  hasDm,
}) => (
  <div className="flex flex-wrap gap-1">
    <span
      className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
        hasBg ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
      }`}
    >
      {hasBg ? '已背调' : '未背调'}
    </span>
    <span
      className={`text-[9px] font-black px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${
        hasProduct ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
      }`}
    >
      <PackageSearch size={9} />
      {hasProduct ? '已采品类' : '未采品类'}
    </span>
    <span
      className={`text-[9px] font-black px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${
        hasDm ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
      }`}
    >
      <Users size={9} />
      {hasDm ? '已挖决策人' : '未挖决策人'}
    </span>
  </div>
);

export const ModuleClientCRM: React.FC<ModuleClientCRMProps> = ({
  clients,
  setClients,
  onBatchAnalyze,
  onBatchDelete,
  onDeleteClient: onDeleteClientProp,
  onBatchDmSearch,
  onBatchProductDig,
  onPurgeBeforeJune2026,
  onRecoverCrm,
  onReanalyze,
  history,
  onOpenHistory,
  productDigBusy,
  onNavOrderChange,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebouncedValue(searchTerm);
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterIndustry, setFilterIndustry] = useState<string>('all');
  const [filterProductType, setFilterProductType] = useState<string>('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  /** all | yes | no */
  const [filterBg, setFilterBg] = useState<'all' | 'yes' | 'no'>('all');
  const [filterProduct, setFilterProduct] = useState<'all' | 'yes' | 'no'>('all');
  const [filterDm, setFilterDm] = useState<'all' | 'yes' | 'no'>('all');
  const [filterOwner, setFilterOwner] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<Client['status'] | 'all' | 'overdue'>('all');
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const resolveOwner = useCallback((client: Client, historyItem?: HistoryItem) => {
    return (client.ownerUsername || historyItem?.ownerUsername || '').trim();
  }, []);

  const historyIndex = useMemo(() => buildHistoryLookupIndex(history), [history]);

  const enrichedClients = useMemo((): EnrichedClient[] => {
    return clients.map((client) => {
      const historyItem = lookupHistoryForClient(client, historyIndex);
      const bgAt = resolveBackgroundCheckAtIndexed(client, historyIndex);
      const hasBg = clientHasBackgroundCheckIndexed(client, historyIndex);
      const hasProduct = hasRichProductCatalog(historyItem?.data);
      const hasDm = historyItem ? historyHasDmSearch(historyItem) : false;
      return {
        client,
        historyItem,
        hasBg,
        hasProduct,
        hasDm,
        bgAt,
        canOpenReport: !!historyItem,
      };
    });
  }, [clients, historyIndex]);

  const filterOptions = useMemo(() => {
    const countries = new Set<string>();
    const productTypes = new Set<string>();
    const owners = new Set<string>();
    for (const row of enrichedClients) {
      const c = row.client;
      if (c.country) countries.add(c.country);
      const pt = (c.productType || '').trim();
      if (pt && pt !== 'N/A') productTypes.add(pt);
      const owner = resolveOwner(c, row.historyItem);
      if (owner) owners.add(owner);
    }
    return {
      countries: [...countries].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      productTypes: [...productTypes].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      owners: [...owners].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    };
  }, [enrichedClients, resolveOwner]);

  const dateFromMs = filterDateFrom ? new Date(filterDateFrom).getTime() : undefined;
  const dateToMs = filterDateTo
    ? new Date(filterDateTo).getTime() + 24 * 60 * 60 * 1000 - 1
    : undefined;

  const filteredEnriched = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return enrichedClients.filter(({ client, historyItem, hasBg, hasProduct, hasDm, bgAt }) => {
      if (q) {
        const owner = resolveOwner(client, historyItem).toLowerCase();
        const hit =
          client.name.toLowerCase().includes(q) ||
          (client.website || '').toLowerCase().includes(q) ||
          (client.productType || '').toLowerCase().includes(q) ||
          owner.includes(q);
        if (!hit) return false;
      }
      if (filterCountry !== 'all' && client.country !== filterCountry) return false;
      if (filterType !== 'all' && client.type !== filterType) return false;
      if (filterProductType !== 'all') {
        const pt = (client.productType || '').trim();
        if (pt !== filterProductType && !pt.toLowerCase().includes(filterProductType.toLowerCase())) {
          return false;
        }
      }
      if (filterIndustry !== 'all' && filterIndustry) {
        const ind = (client.industry || '').toLowerCase();
        const needle = filterIndustry.toLowerCase().split(',')[0].trim();
        if (!ind.includes(needle)) return false;
      }
      if (filterOwner !== 'all') {
        const owner = resolveOwner(client, historyItem);
        if (owner !== filterOwner) return false;
      }
      if (filterBg === 'yes' && !hasBg) return false;
      if (filterBg === 'no' && hasBg) return false;
      if (filterProduct === 'yes' && !hasProduct) return false;
      if (filterProduct === 'no' && hasProduct) return false;
      if (filterDm === 'yes' && !hasDm) return false;
      if (filterDm === 'no' && hasDm) return false;
      if (filterStatus === 'overdue' && !isOverdueFollowUp(client)) return false;
      if (filterStatus !== 'all' && filterStatus !== 'overdue' && client.status !== filterStatus) {
        return false;
      }
      if (dateFromMs != null || dateToMs != null) {
        const t = bgAt || 0;
        if (!t) return false;
        if (dateFromMs != null && t < dateFromMs) return false;
        if (dateToMs != null && t > dateToMs) return false;
      }
      return true;
    });
  }, [
    enrichedClients,
    debouncedSearch,
    filterCountry,
    filterType,
    filterProductType,
    filterIndustry,
    filterOwner,
    filterBg,
    filterProduct,
    filterDm,
    filterStatus,
    dateFromMs,
    dateToMs,
    resolveOwner,
  ]);

  useEffect(() => {
    if (!onNavOrderChange) return;
    const order = filteredEnriched
      .filter((e) => e.historyItem?.id)
      .map((e) => ({ clientId: e.client.id, historyId: e.historyItem!.id }));
    onNavOrderChange(order);
  }, [filteredEnriched, onNavOrderChange]);

  const totalPages = Math.max(1, Math.ceil(filteredEnriched.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedEnriched = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredEnriched.slice(start, start + PAGE_SIZE);
  }, [filteredEnriched, safePage]);

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    filterCountry,
    filterType,
    filterIndustry,
    filterProductType,
    filterDateFrom,
    filterDateTo,
    filterBg,
    filterProduct,
    filterDm,
    filterOwner,
    filterStatus,
  ]);

  const funnelCounts = useMemo(() => {
    const map = Object.fromEntries(CRM_FUNNEL_STAGES.map((s) => [s.value, 0])) as Record<
      Client['status'],
      number
    >;
    for (const c of clients) {
      if (map[c.status] != null) map[c.status] += 1;
      else map['新建/潜在'] += 1;
    }
    return map;
  }, [clients]);

  const overdueCount = useMemo(() => clients.filter(isOverdueFollowUp).length, [clients]);

  const selectedClients = useMemo(
    () => filteredEnriched.filter((e) => selectedClientIds.has(e.client.id)).map((e) => e.client),
    [filteredEnriched, selectedClientIds]
  );

  const patchClient = useCallback(
    (id: string, patch: Partial<Client>) => {
      setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    [setClients]
  );

  const onDeleteClient = useCallback(
    (id: string) => {
      const client = clients.find((c) => c.id === id);
      if (onDeleteClientProp && client) {
        void onDeleteClientProp(client);
        setSelectedClientIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        return;
      }
      setClients((prev) => prev.filter((c) => c.id !== id));
      setSelectedClientIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [clients, onDeleteClientProp, setClients]
  );

  const openClientReport = useCallback(
    (item?: HistoryItem) => {
      if (!item) {
        alert('未找到该客户的背调报告。请先对该网站重新做一次深度调查。');
        return;
      }
      onOpenHistory(item);
    },
    [onOpenHistory]
  );

  const triggerReanalyze = useCallback(
    (client: Client, bgAt?: number) => {
      const timeLabel = formatBackgroundCheckTime(bgAt);
      const tip = timeLabel
        ? `该公司已于 ${timeLabel} 完成背调。是否再次背调以更新信息？`
        : '是否对该客户再次背调？';
      if (!confirm(tip)) return;
      if (onReanalyze) onReanalyze(client);
      else void onBatchAnalyze([client]);
    },
    [onReanalyze, onBatchAnalyze]
  );

  const toggleClient = useCallback((id: string) => {
    setSelectedClientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllOnPage = useCallback(() => {
    const pageIds = pagedEnriched.map((e) => e.client.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedClientIds.has(id));
    setSelectedClientIds((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }, [pagedEnriched, selectedClientIds]);

  const clearFilters = () => {
    setSearchTerm('');
    setFilterCountry('all');
    setFilterType('all');
    setFilterIndustry('all');
    setFilterProductType('all');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterBg('all');
    setFilterProduct('all');
    setFilterDm('all');
    setFilterOwner('all');
    setFilterStatus('all');
  };

  const hasActiveFilters =
    !!debouncedSearch ||
    filterCountry !== 'all' ||
    filterType !== 'all' ||
    filterIndustry !== 'all' ||
    filterProductType !== 'all' ||
    !!filterDateFrom ||
    !!filterDateTo ||
    filterBg !== 'all' ||
    filterProduct !== 'all' ||
    filterDm !== 'all' ||
    filterOwner !== 'all' ||
    filterStatus !== 'all';

  const handleExport = () => {
    const list =
      selectedClients.length > 0
        ? selectedClients
        : filteredEnriched.map((e) => e.client);
    if (!list.length) {
      alert('没有可导出的客户');
      return;
    }
    exportClientsToExcel(list);
  };

  const pageIds = pagedEnriched.map((e) => e.client.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedClientIds.has(id));

  return (
    <div className="max-w-7xl mx-auto space-y-4 sm:space-y-8 animate-fade-in">
      {/* 漏斗 */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black text-slate-800">CRM 商机漏斗</h3>
          <div className="text-[11px] font-bold text-slate-400">
            共 {clients.length} 家
            {filteredEnriched.length !== clients.length && (
              <span className="text-blue-600 ml-1">· 筛选 {filteredEnriched.length} 家</span>
            )}
            {overdueCount > 0 ? (
              <button
                type="button"
                onClick={() => setFilterStatus('overdue')}
                className="ml-2 text-red-600 hover:underline"
              >
                · {overdueCount} 家跟进逾期
              </button>
            ) : (
              ' · 暂无逾期跟进'
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
              filterStatus === 'all'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-600 border-slate-100 hover:border-slate-300'
            }`}
          >
            <div className="text-[10px] font-black uppercase tracking-widest opacity-70">全部</div>
            <div className="text-lg font-black mt-0.5">{clients.length}</div>
          </button>
          {CRM_FUNNEL_STAGES.map((stage) => (
            <button
              key={stage.value}
              type="button"
              onClick={() =>
                setFilterStatus((prev) => (prev === stage.value ? 'all' : stage.value))
              }
              className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                filterStatus === stage.value
                  ? 'ring-2 ring-offset-1 ring-slate-900 ' + funnelToneClass[stage.tone]
                  : funnelToneClass[stage.tone]
              }`}
            >
              <div className="text-[10px] font-black uppercase tracking-widest opacity-70">
                {stage.label}
              </div>
              <div className="text-lg font-black mt-0.5">{funnelCounts[stage.value] || 0}</div>
            </button>
          ))}
        </div>
      </div>

      {clients.length === 0 && onRecoverCrm && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div>
            <div className="font-black text-blue-900 text-sm">CRM 数据为空</div>
            <p className="text-xs text-blue-800/80 mt-1 leading-relaxed">
              若因误删导致数据丢失，可尝试从 GitHub 云端备份、Supabase 或背调历史自动重建客户列表。
              {history.length > 0 && (
                <span className="block mt-1">本地背调历史仍有 {history.length} 条记录可用。</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onRecoverCrm()}
            className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl font-bold text-sm shrink-0"
          >
            <RefreshCw size={16} />
            从云端/背调恢复 CRM
          </button>
        </div>
      )}

      <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-3 sm:gap-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative w-full flex-1">
            <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold text-sm sm:text-base"
              placeholder="搜索客户、网址、产品类型或拥有人..."
            />
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl font-bold text-sm shrink-0"
            title={selectedClients.length ? `导出选中 ${selectedClients.length} 条` : '导出当前筛选结果'}
          >
            <Download size={16} />
            导出 Excel
            {selectedClients.length > 0 ? ` (${selectedClients.length})` : ''}
          </button>
          {onPurgeBeforeJune2026 && (
            <button
              type="button"
              onClick={() => void onPurgeBeforeJune2026()}
              className="inline-flex items-center justify-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 px-4 py-3 rounded-xl font-bold text-xs shrink-0"
              title="删除 2026年6月之前的 CRM 记录（本地+云端）"
            >
              清理6月前旧数据
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2 sm:gap-3">
          <select
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm appearance-none bg-white"
          >
            <option value="all">所有国家</option>
            {filterOptions.countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filterOwner}
            onChange={(e) => setFilterOwner(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm appearance-none bg-white"
            title="按背调拥有人筛选"
          >
            <option value="all">所有拥有人</option>
            {filterOptions.owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <select
            value={filterProductType}
            onChange={(e) => setFilterProductType(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm appearance-none bg-white"
          >
            <option value="all">所有产品类型</option>
            {filterOptions.productTypes.map((p) => (
              <option key={p} value={p}>
                {p.length > 28 ? `${p.slice(0, 26)}…` : p}
              </option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm appearance-none bg-white"
          >
            <option value="all">所有类型</option>
            <option value="进口商">进口商</option>
            <option value="零售商">零售商</option>
            <option value="批发商">批发商</option>
            <option value="分销商">分销商</option>
          </select>
          <div className="col-span-2 sm:col-span-1">
            <IndustryMultiSelect
              compact
              value={filterIndustry === 'all' ? '' : filterIndustry}
              onChange={(v) => setFilterIndustry(v || 'all')}
              placeholder="所有行业"
            />
          </div>
          <label className="flex flex-col gap-0.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
            背调时间起
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="px-2 py-2 rounded-xl border border-slate-200 font-bold text-sm text-slate-700 bg-white normal-case tracking-normal"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
            背调时间止
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="px-2 py-2 rounded-xl border border-slate-200 font-bold text-sm text-slate-700 bg-white normal-case tracking-normal"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <select
            value={filterBg}
            onChange={(e) => setFilterBg(e.target.value as 'all' | 'yes' | 'no')}
            className="px-3 py-2 rounded-xl border border-slate-200 font-bold text-xs sm:text-sm bg-white"
            title="背调状态"
          >
            <option value="all">背调：全部</option>
            <option value="yes">已背调</option>
            <option value="no">未背调</option>
          </select>
          <select
            value={filterProduct}
            onChange={(e) => setFilterProduct(e.target.value as 'all' | 'yes' | 'no')}
            className="px-3 py-2 rounded-xl border border-slate-200 font-bold text-xs sm:text-sm bg-white"
            title="产品品类采集状态"
          >
            <option value="all">品类：全部</option>
            <option value="yes">已采品类</option>
            <option value="no">未采品类</option>
          </select>
          <select
            value={filterDm}
            onChange={(e) => setFilterDm(e.target.value as 'all' | 'yes' | 'no')}
            className="px-3 py-2 rounded-xl border border-slate-200 font-bold text-xs sm:text-sm bg-white"
            title="决策人挖掘状态"
          >
            <option value="all">决策人：全部</option>
            <option value="yes">已挖决策人</option>
            <option value="no">未挖决策人</option>
          </select>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-black text-blue-600 hover:underline"
            >
              清除全部筛选
            </button>
          )}
        </div>

        {selectedClientIds.size > 0 && (
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 w-full">
            <button
              onClick={() => onBatchAnalyze(selectedClients)}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm touch-manipulation inline-flex items-center justify-center gap-2"
              title="批量背调：新增或更新公司背调报告"
            >
              <RefreshCw size={16} />
              批量背调 ({selectedClientIds.size})
            </button>
            {onBatchDmSearch && (
              <button
                type="button"
                onClick={() => onBatchDmSearch(selectedClients)}
                className="w-full sm:w-auto bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm touch-manipulation inline-flex items-center justify-center gap-2"
                title="后台队列并行挖掘/更新决策人邮箱"
              >
                <Users size={16} />
                批量挖掘决策人 ({selectedClientIds.size})
              </button>
            )}
            {onBatchProductDig && (
              <button
                type="button"
                onClick={() => void onBatchProductDig(selectedClients)}
                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm touch-manipulation inline-flex items-center justify-center gap-2"
                title="仅补做旧背调缺品类的客户；新背调已在背调流程内自动采集品类与价格"
              >
                <PackageSearch size={16} />
                {productDigBusy
                  ? `继续补做品类 (${selectedClientIds.size})`
                  : `补做产品品类 (${selectedClientIds.size})`}
              </button>
            )}
            {onBatchDelete && (
              <button
                type="button"
                onClick={async () => {
                  await onBatchDelete(selectedClients);
                  setSelectedClientIds(new Set());
                }}
                className="w-full sm:w-auto bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 px-5 py-2.5 rounded-xl font-bold text-sm touch-manipulation inline-flex items-center justify-center gap-2"
              >
                <Trash2 size={16} />
                批量删除 ({selectedClientIds.size})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-2.5">
        {pagedEnriched.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 font-bold text-sm">
            {clients.length === 0 ? '暂无客户数据' : '没有符合筛选条件的客户'}
          </div>
        ) : (
          pagedEnriched.map(({ client, historyItem, hasBg, hasProduct, hasDm, bgAt, canOpenReport }) => {
            const owner = resolveOwner(client, historyItem);
            return (
            <div key={client.id} className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-sm">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={selectedClientIds.has(client.id)}
                    onChange={() => toggleClient(client.id)}
                    className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => canOpenReport && openClientReport(historyItem)}
                      disabled={!canOpenReport}
                      className={`font-bold text-left truncate block w-full text-sm ${
                        canOpenReport
                          ? 'text-blue-700 hover:underline cursor-pointer'
                          : 'text-slate-800 cursor-default'
                      }`}
                      title={canOpenReport ? '查看背调资料' : undefined}
                    >
                      {client.name}
                    </button>
                    <div className="text-[11px] text-slate-500 font-bold truncate mt-0.5">{client.website}</div>
                    {owner ? (
                      <div className="text-[10px] font-black text-indigo-600 mt-1">拥有人 · {owner}</div>
                    ) : null}
                    {client.productType && client.productType !== 'N/A' && (
                      <div className="text-[10px] font-bold text-violet-600 mt-0.5 truncate">
                        {client.productType}
                      </div>
                    )}
                    <KeywordTags client={client} />
                    <div className="mt-1.5">
                      <IntelChips hasBg={hasBg} hasProduct={hasProduct} hasDm={hasDm} />
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => triggerReanalyze(client, bgAt)}
                    className="text-amber-600 hover:text-amber-700 p-1"
                    title="再次背调"
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button
                    onClick={() => onDeleteClient(client.id)}
                    className="text-red-400 hover:text-red-600 p-1"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-500 mb-2">
                <span className="bg-slate-50 px-2 py-0.5 rounded-md">{client.country}</span>
                <span className="bg-slate-50 px-2 py-0.5 rounded-md">{client.type}</span>
                <BgStatus
                  hasBg={hasBg}
                  canOpen={canOpenReport}
                  timeLabel={formatBackgroundCheckTime(bgAt)}
                  onOpenReport={() => openClientReport(historyItem)}
                  onReanalyze={() => triggerReanalyze(client, bgAt)}
                />
              </div>
              <StageControls client={client} onPatch={patchClient} />
            </div>
            );
          })
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[1080px] table-fixed">
          <thead>
            <tr className="bg-slate-50/90 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleAllOnPage}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="px-3 py-3 w-[18%]">客户名称</th>
              <th className="px-3 py-3 w-[8%]">国家</th>
              <th className="px-3 py-3 w-[10%]">产品类型</th>
              <th className="px-3 py-3 w-[7%]">类型</th>
              <th className="px-3 py-3 w-[12%]">网址</th>
              <th className="px-3 py-3 w-[8%]">拥有人</th>
              <th className="px-3 py-3 w-[14%]">阶段 / 跟进</th>
              <th className="px-3 py-3 w-[12%]">背调 / 进度</th>
              <th className="px-3 py-3 w-16">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pagedEnriched.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-12 text-center text-slate-400 font-bold text-sm">
                  {clients.length === 0 ? '暂无客户数据' : '没有符合筛选条件的客户'}
                </td>
              </tr>
            ) : (
              pagedEnriched.map(({ client, historyItem, hasBg, hasProduct, hasDm, bgAt, canOpenReport }) => {
                const owner = resolveOwner(client, historyItem);
                return (
                <tr key={client.id} className="hover:bg-slate-50/60 transition-colors align-top">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedClientIds.has(client.id)}
                      onChange={() => toggleClient(client.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => canOpenReport && openClientReport(historyItem)}
                      disabled={!canOpenReport}
                      className={`font-bold text-left text-sm leading-snug line-clamp-2 ${
                        canOpenReport
                          ? 'text-blue-700 hover:underline cursor-pointer'
                          : 'text-slate-800 cursor-default'
                      }`}
                      title={canOpenReport ? '点击查看背调资料' : '暂无背调报告'}
                    >
                      {client.name}
                    </button>
                    <KeywordTags client={client} />
                  </td>
                  <td className="px-3 py-2.5 text-xs font-bold text-slate-600 whitespace-nowrap">{client.country || '—'}</td>
                  <td className="px-3 py-2.5 text-xs font-bold text-violet-700 truncate" title={client.productType}>
                    {client.productType && client.productType !== 'N/A' ? client.productType : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-bold text-slate-600 whitespace-nowrap">{client.type || '—'}</td>
                  <td className="px-3 py-2.5 text-xs font-bold text-blue-600 truncate" title={client.website}>
                    {client.website || '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex max-w-full truncate text-[11px] font-black px-2 py-0.5 rounded-md ${
                        owner
                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                          : 'bg-slate-50 text-slate-400 border border-slate-100'
                      }`}
                      title={owner || '未标注拥有人'}
                    >
                      {owner || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <StageControls client={client} onPatch={patchClient} />
                  </td>
                  <td className="px-3 py-2.5 space-y-1.5">
                    <BgStatus
                      hasBg={hasBg}
                      canOpen={canOpenReport}
                      timeLabel={formatBackgroundCheckTime(bgAt)}
                      onOpenReport={() => openClientReport(historyItem)}
                      onReanalyze={() => triggerReanalyze(client, bgAt)}
                    />
                    <IntelChips hasBg={hasBg} hasProduct={hasProduct} hasDm={hasDm} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => triggerReanalyze(client, bgAt)}
                        className="text-amber-600 hover:text-amber-700 p-0.5"
                        title="再次背调"
                      >
                        <RefreshCw size={15} />
                      </button>
                      <button
                        onClick={() => onDeleteClient(client.id)}
                        className="text-red-400 hover:text-red-600 p-0.5"
                        title="删除"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filteredEnriched.length > 0 && (
        <PaginationBar
          page={safePage}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={
            <>
              第 {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredEnriched.length)} 条
              / 共 {filteredEnriched.length} 条
              {selectedClientIds.size > 0 ? ` · 已选 ${selectedClientIds.size}` : ''}
            </>
          }
          className="px-1 pb-4"
        />
      )}
    </div>
  );
};
