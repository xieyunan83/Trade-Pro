import React, { useEffect } from 'react';
import { Client, HistoryItem } from '../types';
import { Search, CheckCircle2, AlertTriangle, Trash2, ExternalLink } from 'lucide-react';
import { clientHasBackgroundCheck, findHistoryForClient } from '../utils/crmHistory';

interface ModuleClientCRMProps {
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  onBatchAnalyze: (clients: Client[]) => Promise<void>;
  history: HistoryItem[];
  onOpenHistory: (item: HistoryItem) => void;
}

export const ModuleClientCRM: React.FC<ModuleClientCRMProps> = ({
  clients,
  setClients,
  onBatchAnalyze,
  history,
  onOpenHistory,
}) => {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [filterCountry, setFilterCountry] = React.useState<string>('all');
  const [filterType, setFilterType] = React.useState<string>('all');
  const [filterIndustry, setFilterIndustry] = React.useState<string>('all');
  const [filterBackgroundCheck, setFilterBackgroundCheck] = React.useState<boolean>(false);
  const [selectedClientIds, setSelectedClientIds] = React.useState<Set<string>>(new Set());

  const needsBgFlagHeal = clients.some(
    (c) => !c.hasBackgroundCheck && (c.hasAnalyzed || !!findHistoryForClient(c, history))
  );

  // Heal legacy CRM rows: import used hasAnalyzed but filter checked hasBackgroundCheck
  useEffect(() => {
    if (!needsBgFlagHeal) return;
    setClients((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        if (c.hasBackgroundCheck) return c;
        if (c.hasAnalyzed || findHistoryForClient(c, history)) {
          changed = true;
          return { ...c, hasBackgroundCheck: true, hasAnalyzed: true };
        }
        return c;
      });
      return changed ? next : prev;
    });
  }, [needsBgFlagHeal, history, setClients]);

  const onDeleteClient = (id: string) => {
    setClients((prev) => prev.filter((c) => c.id !== id));
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
    const matchesIndustry = filterIndustry === 'all' || c.industry === filterIndustry;
    const matchesBackgroundCheck =
      !filterBackgroundCheck || clientHasBackgroundCheck(c, history);
    return (
      matchesSearch &&
      matchesCountry &&
      matchesType &&
      matchesIndustry &&
      matchesBackgroundCheck
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

  const BgStatus: React.FC<{ client: Client }> = ({ client }) => {
    const checked = clientHasBackgroundCheck(client, history);
    const canOpen = !!findHistoryForClient(client, history);
    if (checked) {
      return (
        <button
          type="button"
          onClick={() => openClientReport(client)}
          disabled={!canOpen}
          title={canOpen ? '查看背调资料' : '已标记背调，但本地无报告'}
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
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-slate-300" title="未做背调">
        <AlertTriangle size={16} />
        <span className="md:hidden text-xs font-bold">未背调</span>
      </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 sm:space-y-8 animate-fade-in">
      <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-3 sm:gap-4">
        <div className="relative w-full">
          <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold text-sm sm:text-base"
            placeholder="搜索客户名称或网址..."
          />
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
          <select
            value={filterIndustry}
            onChange={(e) => setFilterIndustry(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-sm appearance-none bg-white col-span-2 sm:col-span-1"
          >
            <option value="all">所有行业</option>
            {Array.from(new Set(clients.map((c) => c.industry))).map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
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
          <button
            onClick={() => onBatchAnalyze(selectedClients)}
            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm touch-manipulation"
          >
            批量分析 ({selectedClientIds.size})
          </button>
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
                    </div>
                  </div>
                  <button
                    onClick={() => onDeleteClient(client.id)}
                    className="text-red-400 hover:text-red-600 flex-shrink-0 p-1"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                  <span className="bg-slate-50 px-2 py-1 rounded-lg">{client.country}</span>
                  <span className="bg-slate-50 px-2 py-1 rounded-lg">{client.type}</span>
                  <span className="bg-slate-50 px-2 py-1 rounded-lg">{client.industry}</span>
                  <BgStatus client={client} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[640px]">
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
              <th className="px-4 lg:px-6 py-4">行业</th>
              <th className="px-4 lg:px-6 py-4">背调</th>
              <th className="px-4 lg:px-6 py-4 w-20">操作</th>
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
                    </td>
                    <td className="px-4 lg:px-6 py-4 text-sm font-bold text-slate-600">{client.country}</td>
                    <td className="px-4 lg:px-6 py-4 text-sm font-bold text-slate-600">{client.type}</td>
                    <td className="px-4 lg:px-6 py-4 text-sm font-bold text-blue-600 max-w-[180px] truncate">
                      {client.website}
                    </td>
                    <td className="px-4 lg:px-6 py-4 text-sm font-bold text-slate-600">{client.industry}</td>
                    <td className="px-4 lg:px-6 py-4">
                      <BgStatus client={client} />
                    </td>
                    <td className="px-4 lg:px-6 py-4">
                      <button
                        onClick={() => onDeleteClient(client.id)}
                        className="text-red-400 hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
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
