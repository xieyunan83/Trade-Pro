import React, { useEffect, useMemo, useState } from 'react';
import { HistoryItem, DiscoveryArchiveItem, Client, DiscoveryState } from '../types';
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
  ShieldCheck,
  RefreshCw,
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
import {
  historyHasDmSearch,
  isHistoryInCrm,
  normalizeCrmHost,
} from '../utils/crmHistory';
import { hasRichProductCatalog } from '../services/productCatalog';

type RecordTab = 'search' | 'background' | 'all';
type GroupBy = 'keyword' | 'country' | 'time' | 'dmMined';

interface RecordsPanelProps {
  history: HistoryItem[];
  discoveryArchives: DiscoveryArchiveItem[];
  /** Used to show「已入CRM」status tags */
  crmClients?: Client[];
  onClose: () => void;
  onOpenHistory: (item: HistoryItem) => void;
  onDownloadHistory: (item: HistoryItem) => void;
  /** 无 PPT 下载权限时不显示下载按钮 */
  canExportPpt?: boolean;
  onRestoreDiscovery: (archive: DiscoveryArchiveItem) => void;
  onDeleteHistory?: (id: string) => void;
  onDeleteDiscovery?: (id: string) => void;
  /** 批量导入选中的背调 / 搜索归档到 CRM */
  onBatchImportToCrm?: (historyItems: HistoryItem[], discoveryArchives: DiscoveryArchiveItem[]) => void;
  /** 无 CRM 编辑权限时隐藏导入按钮 */
  canImportCrm?: boolean;
  /** 更新背调记录的关键词/国家 */
  onPatchHistory?: (id: string, patch: Partial<Pick<HistoryItem, 'keyword' | 'country'>>) => void;
  /** 批量更新 */
  onBulkPatchHistory?: (ids: string[], patch: Partial<Pick<HistoryItem, 'keyword' | 'country'>>) => void;
  /** 对已有背调记录再次背调 */
  onReanalyzeHistory?: (item: HistoryItem) => void;
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

const historyKeyword = (h: HistoryItem) =>
  (h.keyword || h.data?.searchKeyword || '').trim() || UNCATEGORIZED;

const historyCountry = (h: HistoryItem) =>
  normalizeCountryZh(h.country || h.data?.companyInfo?.headquarters || h.data?.companyInfo?.city || '');

const historyDmMined = (h: HistoryItem) =>
  historyHasDmSearch(h) ? '已挖掘决策人' : '未挖掘决策人';

const discoveryDmMined = () => '搜索记录（无决策人挖掘）';

/** Status chip: done = solid tint, pending = muted outline */
const StatusChip: React.FC<{ done: boolean; doneLabel: string; pendingLabel: string; tone: 'violet' | 'amber' | 'emerald' }> = ({
  done,
  doneLabel,
  pendingLabel,
  tone,
}) => {
  const doneClass =
    tone === 'violet'
      ? 'bg-violet-600 text-white'
      : tone === 'amber'
        ? 'bg-amber-500 text-white'
        : 'bg-emerald-600 text-white';
  const pendingClass = 'bg-slate-100 text-slate-400 border border-slate-200';
  return (
    <span
      className={`text-[9px] font-black px-1.5 py-0.5 rounded ${done ? doneClass : pendingClass}`}
      title={done ? doneLabel : pendingLabel}
    >
      {done ? doneLabel : pendingLabel}
    </span>
  );
};

export const RecordsPanel: React.FC<RecordsPanelProps> = ({
  history,
  discoveryArchives,
  crmClients = [],
  onClose,
  onOpenHistory,
  onDownloadHistory,
  canExportPpt = false,
  onRestoreDiscovery,
  onDeleteHistory,
  onDeleteDiscovery,
  onBatchImportToCrm,
  canImportCrm = false,
  onPatchHistory,
  onBulkPatchHistory,
  onReanalyzeHistory,
}) => {
  const [tab, setTab] = useState<RecordTab>('background');
  const [groupBy, setGroupBy] = useState<GroupBy>('keyword');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [expandInitKey, setExpandInitKey] = useState('');
  const [keywords, setKeywords] = useState<string[]>(() => getCustomKeywords());
  const [countries, setCountries] = useState<string[]>(() => getCustomCountries());
  const [manageOpen, setManageOpen] = useState(false);
  /** 批量删除选中：h:id / d:id */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [isBatchImporting, setIsBatchImporting] = useState(false);
  const [filterDm, setFilterDm] = useState<'all' | 'yes' | 'no'>('all');
  const [filterProduct, setFilterProduct] = useState<'all' | 'yes' | 'no'>('all');
  const [filterCrm, setFilterCrm] = useState<'all' | 'yes' | 'no'>('all');

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
      .filter((h) => {
        if (filterDm !== 'all') {
          const mined = historyHasDmSearch(h);
          if (filterDm === 'yes' && !mined) return false;
          if (filterDm === 'no' && mined) return false;
        }
        if (filterProduct !== 'all') {
          const hasProduct = hasRichProductCatalog(h.data);
          if (filterProduct === 'yes' && !hasProduct) return false;
          if (filterProduct === 'no' && hasProduct) return false;
        }
        if (filterCrm !== 'all') {
          const inCrm = isHistoryInCrm(h, crmClients);
          if (filterCrm === 'yes' && !inCrm) return false;
          if (filterCrm === 'no' && inCrm) return false;
        }
        return true;
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
  }, [history, discoveryArchives, tab, query, filterDm, filterProduct, filterCrm, crmClients]);

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
      } else if (groupBy === 'dmMined') {
        push(row.kind === 'history' ? historyDmMined(row.item) : discoveryDmMined(), row);
      } else {
        push(timeKey(row.kind === 'history' ? row.item.timestamp : row.item.timestamp), row);
      }
    }
    return Array.from(map.entries())
      .map(([key, items]) => ({ key, items }))
      .sort((a, b) => {
        if (groupBy === 'time') return b.key.localeCompare(a.key);
        if (groupBy === 'dmMined') {
          const order = ['未挖掘决策人', '已挖掘决策人', '搜索记录（无决策人挖掘）'];
          return order.indexOf(a.key) - order.indexOf(b.key);
        }
        if (a.key === UNCATEGORIZED) return 1;
        if (b.key === UNCATEGORIZED) return -1;
        return a.key.localeCompare(b.key, 'zh');
      });
  }, [rows, groupBy]);

  // 切换 Tab / 筛选时清空勾选，避免误删不可见项
  useEffect(() => {
    setSelected(new Set());
  }, [tab, query, groupBy, filterDm, filterProduct, filterCrm]);

  const rowSelectKey = (row: Row) =>
    row.kind === 'history' ? `h:${row.item.id}` : `d:${row.item.id}`;

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectGroup = (items: Row[]) => {
    const keys = items.map(rowSelectKey);
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = keys.every((k) => next.has(k));
      if (allOn) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    const keys = rows.map(rowSelectKey);
    setSelected((prev) => {
      if (keys.length > 0 && keys.every((k) => prev.has(k))) return new Set();
      return new Set(keys);
    });
  };

  const selectedCount = selected.size;
  const canBatchDelete = !!(onDeleteHistory || onDeleteDiscovery);
  const canBatchImport = !!(canImportCrm && onBatchImportToCrm);
  const canSelect = canBatchDelete || canBatchImport;

  const resolveSelected = () => {
    const histItems: HistoryItem[] = [];
    const discItems: DiscoveryArchiveItem[] = [];
    selected.forEach((k) => {
      if (k.startsWith('h:')) {
        const item = history.find((h) => h.id === k.slice(2));
        if (item) histItems.push(item);
      } else if (k.startsWith('d:')) {
        const item = discoveryArchives.find((d) => d.id === k.slice(2));
        if (item) discItems.push(item);
      }
    });
    return { histItems, discItems };
  };

  const handleBatchDelete = async () => {
    if (!canBatchDelete || selectedCount === 0 || isBatchDeleting) return;
    const { histItems, discItems } = resolveSelected();
    if (histItems.length === 0 && discItems.length === 0) {
      alert('没有可删除的选中记录。');
      return;
    }
    if (
      !confirm(
        `确定删除已选中的 ${histItems.length + discItems.length} 条记录？\n将同步删除 CRM 中匹配的客户。\n此操作不可恢复。`
      )
    ) {
      return;
    }
    setIsBatchDeleting(true);
    try {
      // 先清选中，立刻给反馈；删除回调内部会先更新列表
      setSelected(new Set());
      for (const item of histItems) {
        if (onDeleteHistory) await onDeleteHistory(item.id);
      }
      for (const item of discItems) {
        if (onDeleteDiscovery) await onDeleteDiscovery(item.id);
      }
      alert(`已删除 ${histItems.length + discItems.length} 条记录（含 CRM 同步）。`);
    } catch (e: any) {
      alert(`批量删除失败: ${e?.message || String(e)}`);
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const handleBatchImportCrm = () => {
    if (!canBatchImport || !onBatchImportToCrm || selectedCount === 0 || isBatchImporting) return;
    const { histItems, discItems } = resolveSelected();
    const discoveryCompanies = discItems.reduce((n, a) => n + (a.results?.length || 0), 0);
    if (histItems.length === 0 && discoveryCompanies === 0) {
      alert('所选记录没有可导入的公司资料。');
      return;
    }
    const parts: string[] = [];
    if (histItems.length) parts.push(`背调 ${histItems.length} 条`);
    if (discoveryCompanies) parts.push(`搜索结果约 ${discoveryCompanies} 家`);
    if (!confirm(`将选中记录导入 CRM？\n${parts.join('，')}\n已存在的客户会更新背调信息，不会重复新建。`)) return;
    setIsBatchImporting(true);
    try {
      onBatchImportToCrm(histItems, discItems);
      setSelected(new Set());
    } finally {
      setIsBatchImporting(false);
    }
  };

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
    if (from === UNCATEGORIZED || groupBy === 'time' || groupBy === 'dmMined') return;
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
    if (name === UNCATEGORIZED || groupBy === 'time' || groupBy === 'dmMined') return;
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
    if (groupBy === 'time' || groupBy === 'dmMined') return;
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
    <div className="fixed inset-y-0 left-0 md:left-72 w-full sm:w-[min(100vw,28rem)] md:w-96 lg:w-[28rem] max-w-full bg-white/95 backdrop-blur-xl shadow-signal z-50 border-r border-slate-200/80 flex flex-col animate-fade-in safe-area-inset">
      <div className="p-3 sm:p-4 border-b border-slate-200/70 bg-gradient-to-r from-slate-50 to-cyan-50/40 flex justify-between items-center gap-2">
        <div className="min-w-0">
          <div className="font-extrabold text-slate-900 text-sm flex items-center gap-2 tracking-tight">
            <FolderOpen size={16} className="text-cyan-600 flex-shrink-0" /> 记录中心
          </div>
          <div className="text-[10px] text-slate-400 font-semibold mt-0.5 truncate tracking-wide">自定义分类 · 可增删改</div>
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

      <div className="px-2 py-2 border-b border-slate-100 flex flex-wrap gap-1">
        {(
          [
            { id: 'keyword' as const, label: '关键词' },
            { id: 'country' as const, label: '国家' },
            { id: 'dmMined' as const, label: '决策人挖掘' },
            { id: 'time' as const, label: '时间' },
          ] as const
        ).map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGroupBy(g.id)}
            className={`flex-1 min-w-[4.5rem] px-2 py-2 rounded-lg text-[10px] font-black touch-manipulation ${
              groupBy === g.id ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'text-slate-500'
            }`}
          >
            按{g.label}
          </button>
        ))}
      </div>
      {groupBy === 'dmMined' && (
        <div className="px-3 py-2 border-b border-slate-100 bg-violet-50/80 text-[10px] font-bold text-violet-700">
          「已挖掘」= 已点过决策人邮箱搜索；「未挖掘」= 背调后尚未搜索决策人，避免重复操作。
        </div>
      )}
      <div className="px-3 py-1.5 text-[9px] text-slate-400 font-semibold border-b border-slate-50 flex flex-wrap gap-1.5 items-center">
        <span className="mr-0.5">状态:</span>
        <StatusChip done doneLabel="已背调" pendingLabel="未背调" tone="violet" />
        <StatusChip done doneLabel="已挖决策人" pendingLabel="未挖决策人" tone="amber" />
        <StatusChip done doneLabel="已采品类" pendingLabel="未采品类" tone="emerald" />
        <StatusChip done doneLabel="已入CRM" pendingLabel="未入CRM" tone="emerald" />
        <span className="text-slate-300 ml-0.5">灰底 = 未完成</span>
      </div>
      {(tab === 'background' || tab === 'all') && (
        <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-2 items-center bg-slate-50/60">
          <span className="text-[10px] font-black text-slate-500">筛选:</span>
          <select
            value={filterDm}
            onChange={(e) => setFilterDm(e.target.value as typeof filterDm)}
            className="text-[10px] font-bold border border-slate-200 rounded-lg px-2 py-1 bg-white"
          >
            <option value="all">决策人: 全部</option>
            <option value="yes">已挖决策人</option>
            <option value="no">未挖决策人</option>
          </select>
          <select
            value={filterProduct}
            onChange={(e) => setFilterProduct(e.target.value as typeof filterProduct)}
            className="text-[10px] font-bold border border-slate-200 rounded-lg px-2 py-1 bg-white"
          >
            <option value="all">品类: 全部</option>
            <option value="yes">已采品类</option>
            <option value="no">未采品类</option>
          </select>
          <select
            value={filterCrm}
            onChange={(e) => setFilterCrm(e.target.value as typeof filterCrm)}
            className="text-[10px] font-bold border border-slate-200 rounded-lg px-2 py-1 bg-white"
          >
            <option value="all">CRM: 全部</option>
            <option value="yes">已入CRM</option>
            <option value="no">未入CRM</option>
          </select>
        </div>
      )}

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

      <div className="px-3 py-2 border-b border-slate-100 flex gap-2 items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
          />
        </div>
        {canSelect && (
          <>
            <button
              type="button"
              onClick={toggleSelectAllVisible}
              disabled={rows.length === 0}
              className="px-2 py-2 rounded-xl border border-slate-200 text-[10px] font-black text-slate-600 touch-manipulation whitespace-nowrap disabled:opacity-40"
            >
              {rows.length > 0 && rows.every((r) => selected.has(rowSelectKey(r))) ? '取消全选' : '全选'}
            </button>
            {canBatchImport && (
              <button
                type="button"
                onClick={handleBatchImportCrm}
                disabled={selectedCount === 0 || isBatchImporting}
                className="px-2 py-2 rounded-xl bg-emerald-50 border border-emerald-100 text-[10px] font-black text-emerald-700 touch-manipulation whitespace-nowrap disabled:opacity-40 inline-flex items-center gap-1"
              >
                <ShieldCheck size={12} />
                {isBatchImporting
                  ? '导入中…'
                  : selectedCount > 0
                    ? `批量导入CRM(${selectedCount})`
                    : '批量导入CRM'}
              </button>
            )}
            {canBatchDelete && (
              <button
                type="button"
                onClick={() => void handleBatchDelete()}
                disabled={selectedCount === 0 || isBatchDeleting}
                className="px-2 py-2 rounded-xl bg-red-50 border border-red-100 text-[10px] font-black text-red-600 touch-manipulation whitespace-nowrap disabled:opacity-40 inline-flex items-center gap-1"
              >
                <Trash2 size={12} />
                {isBatchDeleting ? '删除中…' : selectedCount > 0 ? `批量删除(${selectedCount})` : '批量删除'}
              </button>
            )}
          </>
        )}
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
                  {canSelect && (
                    <label
                      className="flex items-center pl-2 touch-manipulation"
                      onClick={(e) => e.stopPropagation()}
                      title="全选本组"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-slate-300"
                        checked={g.items.length > 0 && g.items.every((r) => selected.has(rowSelectKey(r)))}
                        onChange={() => toggleSelectGroup(g.items)}
                      />
                    </label>
                  )}
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
                        <div
                          key={`h-${row.item.id}`}
                          className={`p-3 hover:bg-blue-50/60 ${selected.has(rowSelectKey(row)) ? 'bg-blue-50/80' : ''}`}
                          onClick={() => onOpenHistory(row.item)}
                        >
                          <div className="flex items-start gap-2">
                            {canSelect && (
                              <label
                                className="pt-0.5 touch-manipulation"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  className="rounded border-slate-300"
                                  checked={selected.has(rowSelectKey(row))}
                                  onChange={() => toggleSelect(rowSelectKey(row))}
                                />
                              </label>
                            )}
                            <Building2 size={14} className="text-blue-500 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-black text-slate-800 truncate">{row.item.data?.companyInfo?.name || row.item.domain}</div>
                              <div className="text-[10px] text-slate-400 truncate">{row.item.domain}</div>
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                <StatusChip done doneLabel="已背调" pendingLabel="未背调" tone="violet" />
                                <span className="text-[9px] font-black bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded border border-violet-100">
                                  {new Date(row.item.timestamp).toLocaleString('zh-CN', {
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: false,
                                  })}
                                </span>
                                <StatusChip
                                  done={historyHasDmSearch(row.item)}
                                  doneLabel="已挖决策人"
                                  pendingLabel="未挖决策人"
                                  tone="amber"
                                />
                                <StatusChip
                                  done={hasRichProductCatalog(row.item.data)}
                                  doneLabel="已采品类"
                                  pendingLabel="未采品类"
                                  tone="emerald"
                                />
                                <StatusChip
                                  done={isHistoryInCrm(row.item, crmClients)}
                                  doneLabel="已入CRM"
                                  pendingLabel="未入CRM"
                                  tone="emerald"
                                />
                                <span className="text-[9px] font-black bg-slate-50 text-slate-500 px-1.5 py-0.5 rounded border border-slate-100">
                                  {historyKeyword(row.item)}
                                </span>
                                <span className="text-[9px] font-black bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded">
                                  {historyCountry(row.item)}
                                </span>
                                {(row.item.data?.searchTags || [])
                                  .filter((t) => typeof t === 'string' && !t.startsWith('关键词:') && !t.startsWith('国家:'))
                                  .slice(0, 3)
                                  .map((t) => (
                                    <span key={t} className="text-[9px] font-black bg-slate-50 text-slate-500 px-1.5 py-0.5 rounded border border-slate-100">
                                      {t}
                                    </span>
                                  ))}
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
                            {onReanalyzeHistory && (
                              <button
                                type="button"
                                className="text-[10px] font-black text-amber-700"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onReanalyzeHistory(row.item);
                                }}
                                title="再次背调"
                              >
                                <RefreshCw size={11} className="inline" /> 再次背调
                              </button>
                            )}
                            {canExportPpt && (
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
                            )}
                            {onDeleteHistory && (
                              <button
                                type="button"
                                className="text-red-400"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm('删除该背调记录？将同步删除 CRM 中匹配客户。')) onDeleteHistory(row.item.id);
                                }}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div
                          key={`d-${row.item.id}`}
                          className={`p-3 hover:bg-emerald-50/60 ${selected.has(rowSelectKey(row)) ? 'bg-emerald-50/80' : ''}`}
                          onClick={() => onRestoreDiscovery(row.item)}
                        >
                          <div className="flex items-start gap-2">
                            {canSelect && (
                              <label
                                className="pt-0.5 touch-manipulation"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  className="rounded border-slate-300"
                                  checked={selected.has(rowSelectKey(row))}
                                  onChange={() => toggleSelect(rowSelectKey(row))}
                                />
                              </label>
                            )}
                            <Globe size={14} className="text-emerald-500 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-black truncate">{row.item.product || '搜索'}</div>
                              <div className="text-[10px] text-slate-400">{row.item.results?.length || 0} 家客户</div>
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                <span className="text-[9px] font-black bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">客户搜索</span>
                                {(() => {
                                  const results = row.item.results || [];
                                  let bgCount = 0;
                                  let crmCount = 0;
                                  for (const r of results) {
                                    const host = normalizeCrmHost(r.website);
                                    if (!host) continue;
                                    if (
                                      history.some(
                                        (h) =>
                                          normalizeCrmHost(h.domain || h.data?.companyInfo?.website) === host
                                      )
                                    ) {
                                      bgCount += 1;
                                    }
                                    if (crmClients.some((c) => normalizeCrmHost(c.website) === host)) {
                                      crmCount += 1;
                                    }
                                  }
                                  return (
                                    <>
                                      <StatusChip
                                        done={bgCount > 0}
                                        doneLabel={`已背调 ${bgCount}/${results.length}`}
                                        pendingLabel="未背调 0"
                                        tone="violet"
                                      />
                                      <StatusChip
                                        done={crmCount > 0}
                                        doneLabel={`已入CRM ${crmCount}/${results.length}`}
                                        pendingLabel="未入CRM 0"
                                        tone="emerald"
                                      />
                                    </>
                                  );
                                })()}
                                <span className="text-[9px] font-black bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                                  关键词:{discoveryKeyword(row.item)}
                                </span>
                                {(row.item.countries || []).slice(0, 2).map((c) => (
                                  <span key={c} className="text-[9px] font-black bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded">
                                    国家:{c}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                          {onDeleteDiscovery && (
                            <div className="flex justify-end mt-2">
                              <button
                                type="button"
                                className="text-red-400"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm('删除该搜索记录？将同步删除 CRM 中匹配客户。')) onDeleteDiscovery(row.item.id);
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
