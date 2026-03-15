
import React, { useState } from 'react';
import { Client, HistoryItem } from '../types';
import { Users, Globe, MapPin, Briefcase, Calendar, Search, Filter, Plus, Trash2, Edit2, CheckCircle2, AlertTriangle, MoreVertical, ExternalLink } from 'lucide-react';

interface ModuleClientCRMProps {
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  onBatchAnalyze: (clients: Client[]) => Promise<void>;
  history: HistoryItem[];
}

export const ModuleClientCRM: React.FC<ModuleClientCRMProps> = ({ clients, setClients, onBatchAnalyze, history }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterIndustry, setFilterIndustry] = useState<string>('all');
  const [filterBackgroundCheck, setFilterBackgroundCheck] = useState<boolean>(false);
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());

  const onDeleteClient = (id: string) => {
    setClients(prev => prev.filter(c => c.id !== id));
  };

  const onAnalyze = (domain: string) => {
    console.log("Analyzing", domain);
  };

  const filteredClients = clients.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (c.website || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
    const matchesCountry = filterCountry === 'all' || c.country === filterCountry;
    const matchesType = filterType === 'all' || c.type === filterType;
    const matchesIndustry = filterIndustry === 'all' || c.industry === filterIndustry;
    const matchesBackgroundCheck = !filterBackgroundCheck || c.hasBackgroundCheck;
    return matchesSearch && matchesStatus && matchesCountry && matchesType && matchesIndustry && matchesBackgroundCheck;
  });

  const toggleClient = (id: string) => {
    const next = new Set(selectedClientIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedClientIds(next);
  };

  const toggleAll = () => {
    if (selectedClientIds.size === filteredClients.length) setSelectedClientIds(new Set());
    else setSelectedClientIds(new Set(filteredClients.map(c => c.id)));
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in">
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
            <input 
              type="text" 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 font-bold"
              placeholder="搜索客户名称或网址..."
            />
          </div>
          <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)} className="px-4 py-3 rounded-xl border border-slate-200 font-bold appearance-none bg-white">
            <option value="all">所有国家</option>
            {Array.from(new Set(clients.map(c => c.country))).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-4 py-3 rounded-xl border border-slate-200 font-bold appearance-none bg-white">
            <option value="all">所有类型</option>
            <option value="进口商">进口商</option>
            <option value="零售商">零售商</option>
            <option value="批发商">批发商</option>
            <option value="分销商">分销商</option>
          </select>
          <select value={filterIndustry} onChange={e => setFilterIndustry(e.target.value)} className="px-4 py-3 rounded-xl border border-slate-200 font-bold appearance-none bg-white">
            <option value="all">所有行业</option>
            {Array.from(new Set(clients.map(c => c.industry))).map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <label className="flex items-center gap-2 font-bold text-sm text-slate-700">
            <input 
              type="checkbox" 
              checked={filterBackgroundCheck}
              onChange={e => setFilterBackgroundCheck(e.target.checked)}
              className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            已做背调
          </label>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
              <th className="px-6 py-4 w-12"><input type="checkbox" checked={selectedClientIds.size === filteredClients.length && filteredClients.length > 0} onChange={toggleAll} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></th>
              <th className="px-6 py-4">客户名称</th>
              <th className="px-6 py-4">国家</th>
              <th className="px-6 py-4">类型</th>
              <th className="px-6 py-4">网址</th>
              <th className="px-6 py-4">行业</th>
              <th className="px-6 py-4">背调</th>
              <th className="px-6 py-4 w-20">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredClients.map(client => (
              <tr key={client.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4"><input type="checkbox" checked={selectedClientIds.has(client.id)} onChange={() => toggleClient(client.id)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></td>
                <td className="px-6 py-4 font-bold text-slate-800">{client.name}</td>
                <td className="px-6 py-4 text-sm font-bold text-slate-600">{client.country}</td>
                <td className="px-6 py-4 text-sm font-bold text-slate-600">{client.type}</td>
                <td className="px-6 py-4 text-sm font-bold text-blue-600">{client.website}</td>
                <td className="px-6 py-4 text-sm font-bold text-slate-600">{client.industry}</td>
                <td className="px-6 py-4">{client.hasBackgroundCheck ? <CheckCircle2 className="text-green-500" size={16} /> : <AlertTriangle className="text-slate-300" size={16} />}</td>
                <td className="px-6 py-4">
                  <button onClick={() => onDeleteClient(client.id)} className="text-red-400 hover:text-red-600"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
