import React, { useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import {
  clientHasBackgroundCheck,
  findHistoryForClient,
  formatBackgroundCheckTime,
  resolveBackgroundCheckAt,
} from '../utils/crmHistory';
import { exportClientsToExcel } from '../services/exportService';
import { IndustryMultiSelect } from './IndustryMultiSelect';

interface ModuleClientCRMProps {
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  onBatchAnalyze: (clients: Client[]) => Promise<void>;
  /** 对已背调客户批量产品品类深挖 */
  onBatchProductDig?: (clients: Client[]) => Promise<void>;
  /** 单客户再次背调（与批量同一入口） */
  onReanalyze?: (client: Client) => void;
  history: HistoryItem[];
  onOpenHistory: (item: HistoryItem) => void;
  productDigBusy?: boolean;
}

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

export const ModuleClientCRM: React.FC<ModuleClientCRMProps> = ({
  clients,
  setClients,
  onBatchAnalyze,
  onBatchProductDig,
  onReanalyze,
  history,
  onOpenHistory,
  productDigBusy,
}) => {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [filterCountry, setFilterCountry] = React.useState<string>('all');
  const [filterType, setFilterType] = React.useState<string>('all');
  const [filterIndustry, setFilterIndustry] = React.useState<string>('all');
  const [filterBackgroundCheck, setFilterBackgroundCheck] = React.useState<boolean>(false);
  const [filterStatus, setFilterStatus] = React.useState<Client['status'] | 'all' | 'overdue'>('all');
  const [selectedClientIds, setSelectedClientIds] = React.useState<Set<string>>(new Set());

  const needsBgFlagHeal = clients.some(
    (c) => !c.hasBackgroundCheck && (c.hasAnalyzed || !!findHistoryForClient(c, history))
  );

  useEffect(() => {
    if (!needsBgFlagHeal) return;
    setClients((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        if (c.hasBackgroundCheck) return c;
        const hist = findHistoryForClient(c, history);
        if (c.hasAnalyzed || hist) {
          changed = true;
          return {
            ...c,
            hasBackgroundCheck: true,
            hasAnalyzed: true,
            lastBackgroundCheckAt: c.lastBackgroundCheckAt || hist?.timestamp,
          };
        }
        return c;
      });
      return changed ? next : prev;
    });
  }, [needsBgFlagHeal, history, setClients]);

  useEffect(() => {
    setClients((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        if (c.lastBackgroundCheckAt) return c;
        const hist = findHistoryForClient(c, history);
        if (!hist?.timestamp) return c;
        changed = true;
        return { ...c, lastBackgroundCheckAt: hist.timestamp, hasBackgroundCheck: true };
      });
      return changed ? next : prev;
    });
  }, [history, setClients]);

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

  const onDeleteClient = (id: string) => {
    setClients((prev) => prev.filter((c) => c.id !== id));
  };

  const patchClient = (id: string, patch: Partial<Client>) => {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const openClientReport = (client: Client) => {
    const item = findHistoryForClient(client, history);
    if (!item) {
      alert('未找到该客户的背调报告。请先对该网站重新做一次深度调查。');
      return;
    }
    onOpenHistory(item);
  };

  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.website || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCountry = filterCountry === 'all' || c.country === filterCountry;
    const matchesType = filterType === 'all' || c.type === filterType;
    const matchesIndustry =
      filterIndustry === 'all' ||
      !filterIndustry ||
      (c.industry || '').toLowerCase().includes(filterIndustry.toLowerCase().split(',')[0].trim());
    const matchesBackgroundCheck =
      !filterBackgroundCheck || clientHasBackgroundCheck(c, history);
    const matchesStatus =
      filterStatus === 'all'
        ? true
        : filterStatus === 'overdue'
          ? isOverdueFollowUp(c)
          : c.status === filterStatus;
    return (
      matchesSearch &&
      matchesCountry &&
      matchesType &&
      matchesIndustry &&
      matchesBackgroundCheck &&
      matchesStatus
    );
  });

  const toggleClient = (id: string) => {
    const next = new Set(selectedClientIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedClientIds(next);
  };

  const toggleAll = () => {
    if (selectedClientIds.size === filteredClients.length) setSelectedClientIds(new Set());
    else setSelectedClientIds(new Set(filteredClients.map((c) => c.id)));
  };

  const selectedClients = filteredClients.filter((c) => selectedClientIds.has(c.id));

  const triggerReanalyze = (client: Client) => {
    const at = resolveBackgroundCheckAt(client, history);
    const timeLabel = formatBackgroundCheckTime(at);
    const tip = timeLabel
      ? `该公司已于 ${timeLabel} 完成背调。是否再次背调以更新信息？`
      : '是否对该客户再次背调？';
    if (!confirm(tip)) return;
    if (onReanalyze) onReanalyze(client);
    else void onBatchAnalyze([client]);
  };

  const handleExport = () => {
    const list = selectedClients.length > 0 ? selectedClients : filteredClients;
    if (!list.length) {
      alert('没有可导出的客户');
      return;
    }
    exportClientsToExcel(list);
  };

  const KeywordTags: React.FC<{ client: Client }> = ({ client }) => {
    const kws = Array.from(
      new Set(
        [
          client.searchKeyword,
          ...(client.searchedKeywords || []),
          ...(client.tags || [])
            .filter((t) => t.startsWith('关键词:'))
            .map((t) => t.replace(/^关键词:/, '')),
        ].filter(Boolean) as string[]
      )
    ).slice(0, 4);
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
  };

  const BgStatus: React.FC<{ client: Client }> = ({ client }) => {
    const checked = clientHasBackgroundCheck(client, history);
    const canOpen = !!findHistoryForClient(client, history);
    const at = resolveBackgroundCheckAt(client, history);
    const timeLabel = formatBackgroundCheckTime(at);
    if (checked) {
      return (
        <div className="inline-flex flex-col items-start gap-0.5">
          <button
            type="button"
            onClick={() => openClientReport(client)}
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
            onClick={() => triggerReanalyze(client)}
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
          onClick={() => triggerReanalyze(client)}
          className="inline-flex items-center gap-0.5 text-[10px] font-black text-blue-600 hover:underline"
        >
          <RefreshCw size={10} /> 去背调
        </button>
      </div>
    );
  };

  const StageControls: React.FC<{ client: Client }> = ({ client }) => {
    const overdue = isOverdueFollowUp(client);
    return (
      <div className="flex flex-col gap-1.5 min-w-[140px]">
        <select
          value={client.status}
          onChange={(e) => patchClient(client.id, { status: e.target.value as Client['status'] })}
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
            onChange={(e) => patchClient(client.id, { nextFollowUpDate: e.target.value })}
            className={`flex-1 min-w-0 px-1.5 py-1 rounded-lg border text-[11px] font-bold ${
              overdue ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'
            }`}
          />
        </label>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 sm:space-y-8 animate-fade-in">
      {/* 漏斗 */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black text-slate-800">CRM 商机漏斗</h3>
          <div className="text-[11px] font-bold text-slate-400">
            共 {clients.length} 家
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

      <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-3 sm:gap-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative w-full flex-1">
            <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold text-sm sm:text-base"
              placeholder="搜索客户名称或网址..."
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
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
          <select
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm appearance-none bg-white"
          >
            <option value="all">所有国家</option>
            {Array.from(new Set(clients.map((c) => c.country))).map((c) => (
              <option key={c} value={c}>
                {c}
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
          <label className="flex items-center gap-2 font-bold text-xs sm:text-sm text-slate-700 col-span-2 sm:col-span-2 lg:col-span-2">
            <input
              type="checkbox"
              checked={filterBackgroundCheck}
              onChange={(e) => setFilterBackgroundCheck(e.target.checked)}
              className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            已做背调
          </label>
        </div>
        {selectedClientIds.size > 0 && (
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button
              onClick={() => onBatchAnalyze(selectedClients)}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm touch-manipulation"
            >
              批量分析 ({selectedClientIds.size})
            </button>
            {onBatchProductDig && (
              <button
                type="button"
                disabled={productDigBusy || !selectedClients.some((c) => clientHasBackgroundCheck(c, history))}
                onClick={() => {
                  const diggable = selectedClients.filter((c) => clientHasBackgroundCheck(c, history));
                  if (!diggable.length) {
                    alert('所选客户中没有「已做背调」的记录。请先完成背调，或勾选已背调客户。');
                    return;
                  }
                  void onBatchProductDig(diggable);
                }}
                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm touch-manipulation disabled:opacity-50 inline-flex items-center justify-center gap-2"
                title="仅针对已背调客户：联网深挖品类与价格，写入产品匹配库"
              >
                <PackageSearch size={16} />
                {productDigBusy ? '产品深挖中…' : `产品深挖 (${selectedClients.filter((c) => clientHasBackgroundCheck(c, history)).length})`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {filteredClients.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 font-bold text-sm">
            暂无客户数据
          </div>
        ) : (
          filteredClients.map((client) => {
            const canOpen = !!findHistoryForClient(client, history);
            return (
              <div key={client.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedClientIds.has(client.id)}
                      onChange={() => toggleClient(client.id)}
                      className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => canOpen && openClientReport(client)}
                        disabled={!canOpen}
                        className={`font-bold text-left truncate block w-full ${
                          canOpen
                            ? 'text-blue-700 hover:underline cursor-pointer'
                            : 'text-slate-800 cursor-default'
                        }`}
                        title={canOpen ? '查看背调资料' : undefined}
                      >
                        {client.name}
                      </button>
                      <div className="text-xs text-blue-600 font-bold truncate mt-0.5">{client.website}</div>
                      <KeywordTags client={client} />
                    </div>
                  </div>
                  <div className="flex items-start gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => triggerReanalyze(client)}
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
                <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-500 mb-3">
                  <span className="bg-slate-50 px-2 py-1 rounded-lg">{client.country}</span>
                  <span className="bg-slate-50 px-2 py-1 rounded-lg">{client.type}</span>
                  <span className="bg-slate-50 px-2 py-1 rounded-lg">{client.industry}</span>
                  <BgStatus client={client} />
                </div>
                <StageControls client={client} />
              </div>
            );
          })
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[920px]">
          <thead>
            <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
              <th className="px-4 lg:px-6 py-4 w-12">
                <input
                  type="checkbox"
                  checked={selectedClientIds.size === filteredClients.length && filteredClients.length > 0}
                  onChange={toggleAll}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="px-4 lg:px-6 py-4">客户名称</th>
              <th className="px-4 lg:px-6 py-4">国家</th>
              <th className="px-4 lg:px-6 py-4">类型</th>
              <th className="px-4 lg:px-6 py-4">网址</th>
              <th className="px-4 lg:px-6 py-4">阶段 / 跟进</th>
              <th className="px-4 lg:px-6 py-4">背调</th>
              <th className="px-4 lg:px-6 py-4 w-28">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredClients.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-slate-400 font-bold text-sm">
                  暂无客户数据
                </td>
              </tr>
            ) : (
              filteredClients.map((client) => {
                const canOpen = !!findHistoryForClient(client, history);
                return (
                  <tr key={client.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 lg:px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedClientIds.has(client.id)}
                        onChange={() => toggleClient(client.id)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 lg:px-6 py-4">
                      <button
                        type="button"
                        onClick={() => canOpen && openClientReport(client)}
                        disabled={!canOpen}
                        className={`font-bold text-left ${
                          canOpen
                            ? 'text-blue-700 hover:underline cursor-pointer'
                            : 'text-slate-800 cursor-default'
                        }`}
                        title={canOpen ? '点击查看背调资料' : '暂无背调报告'}
                      >
                        {client.name}
                      </button>
                      <KeywordTags client={client} />
                    </td>
                    <td className="px-4 lg:px-6 py-4 text-sm font-bold text-slate-600">{client.country}</td>
                    <td className="px-4 lg:px-6 py-4 text-sm font-bold text-slate-600">{client.type}</td>
                    <td className="px-4 lg:px-6 py-4 text-sm font-bold text-blue-600 max-w-[160px] truncate">
                      {client.website}
                    </td>
                    <td className="px-4 lg:px-6 py-4">
                      <StageControls client={client} />
                    </td>
                    <td className="px-4 lg:px-6 py-4">
                      <BgStatus client={client} />
                    </td>
                    <td className="px-4 lg:px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => triggerReanalyze(client)}
                          className="text-amber-600 hover:text-amber-700"
                          title="再次背调"
                        >
                          <RefreshCw size={16} />
                        </button>
                        <button
                          onClick={() => onDeleteClient(client.id)}
                          className="text-red-400 hover:text-red-600"
                          title="删除"
                        >
                          <Trash2 size={16} />
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
    </div>
  );
};
